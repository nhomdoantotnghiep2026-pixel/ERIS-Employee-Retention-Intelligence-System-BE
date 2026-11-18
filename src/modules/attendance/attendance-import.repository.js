const {workWarnings}=require('../holidays/holidays');
const { lockEmployee, assertNoLeave } = require('../leave-records/leave-records.repository');
const { fail } = require('./attendance-import.rules');
const { writeAudit } = require('../audit_logs/audit.repository');
// Format local timestamps in SQL; pg's host timezone must never change their meaning.
const projection = `a.*, a.work_date::text AS work_date,
  to_char(a.check_in,'YYYY-MM-DD"T"HH24:MI:SS') || '+07:00' AS check_in,
  to_char(a.check_out,'YYYY-MM-DD"T"HH24:MI:SS') || '+07:00' AS check_out,
  to_char(a.created_at,'YYYY-MM-DD"T"HH24:MI:SS') || '+07:00' AS created_at,
  to_char(a.updated_at,'YYYY-MM-DD"T"HH24:MI:SS') || '+07:00' AS updated_at`;
class AttendanceImportRepository {
  constructor(pool) { this.pool = pool; }
  async transaction(work) {
    const client=await this.pool.connect();
    try { await client.query('BEGIN'); const result=await work(client); await client.query('COMMIT'); return result; }
    catch(e) { await client.query('ROLLBACK'); throw e; }
    finally { client.release(); }
  }
  async actor(db, userId, hr=false, lock=false) {
    const {rows}=await db.query(`SELECT u.id,u.status,u.employee_id AS "employeeId",r.name AS role_name
      FROM users u JOIN role r ON r.id=u.role_id WHERE u.id=$1 ${lock?'FOR SHARE OF u,r':''}`, [userId]);
    const u=rows[0];
    if (!u || u.status!=='ACTIVE') fail('UNAUTHORIZED','An active account is required.',401);
    if (hr && u.role_name!=='HR') fail('FORBIDDEN','Only HR can manage attendance.',403);
    return u;
  }
  async references(db) {
    const employees=(await db.query('SELECT id,employee_code,full_name,hire_date::text,work_schedule_id,employment_status FROM employees')).rows;
    const schedules=(await db.query('SELECT * FROM work_schedules WHERE shift_type IS NOT NULL ORDER BY id')).rows;
    return { employees, schedules };
  }
  async current(db, employeeId, workDate, lock=false) {
    return (await db.query(`SELECT ${projection} FROM attendance a WHERE employee_id=$1 AND work_date=$2::date AND record_status='ACTIVE' ${lock?'FOR UPDATE':''}`, [employeeId,workDate])).rows[0] || null;
  }
  async find(db, id, lock=false) {
    return (await db.query(`SELECT ${projection},e.employee_code,e.full_name FROM attendance a JOIN employees e ON e.id=a.employee_id
      WHERE a.id=$1 ${lock?'FOR UPDATE OF a':''}`, [id])).rows[0] || null;
  }
  async lockKey(db, employeeId, workDate) {
    await lockEmployee(db, employeeId);
    await db.query("SELECT pg_advisory_xact_lock(hashtext('attendance:' || $1::text || ':' || $2::text))",[employeeId,workDate]);
  }
  async audit(db,actorId,action,before,after,reason=null) {
    await writeAudit(db,{actorId,entityType:'attendance',entityId:after.id,action,oldValue:before,newValue:{...after,audit_reason:reason}});
  }
  async overlapping(db,employeeId,checkIn,checkOut) {
    return (await db.query(`SELECT id,work_date::text FROM attendance WHERE employee_id=$1 AND record_status='ACTIVE'
      AND check_in < ($3::timestamptz AT TIME ZONE 'Asia/Ho_Chi_Minh')
      AND check_out > ($2::timestamptz AT TIME ZONE 'Asia/Ho_Chi_Minh')`,[employeeId,checkIn,checkOut])).rows;
  }
  async write(db, row, before, actorId, reason=null) {
    if(before) fail('ATTENDANCE_EXISTS','Cancel the existing record, then preview and import a replacement.',409);
    if(row.check_in || row.check_out) await assertNoLeave(db,row.employee_id,row.work_date);
    const values=[row.employee_id,row.work_date,row.work_schedule_id,row.check_in,row.check_out,row.working_minutes,
      row.late_mins,row.early_mins,row.overtime_minutes,row.attendance_status||'PRESENT'];
    const result=await db.query(`INSERT INTO attendance(employee_id,work_date,work_schedule_id,check_in,check_out,working_minutes,
      late_mins,early_mins,overtime_minutes,attendance_status,record_status)
      VALUES($1,$2,$3,$4::timestamptz AT TIME ZONE 'Asia/Ho_Chi_Minh',$5::timestamptz AT TIME ZONE 'Asia/Ho_Chi_Minh',
        $6,$7,$8,$9,$10,'ACTIVE') RETURNING id`,values);
    const after=await this.find(db,result.rows[0].id);
    after.holiday_warnings=row.check_in&&row.check_out?await workWarnings(db,row.employee_id,row.check_in,row.check_out):[];
    await this.audit(db,actorId,'CREATE',null,{...after,...(row.derived_source?{derived_source:row.derived_source}:{}),
      ...(row.schedule_snapshot?{calculation_schedule:row.schedule_snapshot}:{})},reason);
    return after;
  }
}
module.exports={AttendanceImportRepository,projection};
