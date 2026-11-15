const { lockEmployee, assertNoLeave } = require('../leave-records/leave-records.repository');
const { fail, CALCULATION_VERSION } = require('./attendance-import.rules');
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
    const employees=(await db.query('SELECT id,employee_code,full_name FROM employees')).rows;
    const schedules=(await db.query('SELECT * FROM work_schedules WHERE shift_type IS NOT NULL ORDER BY id')).rows;
    return { employees, schedules };
  }
  async current(db, employeeId, workDate, lock=false) {
    return (await db.query(`SELECT ${projection} FROM attendance a WHERE employee_id=$1 AND work_date=$2::date ${lock?'FOR UPDATE':''}`, [employeeId,workDate])).rows[0] || null;
  }
  async find(db, id, lock=false) {
    return (await db.query(`SELECT ${projection},e.employee_code,e.full_name FROM attendance a JOIN employees e ON e.id=a.employee_id
      WHERE a.id=$1 ${lock?'FOR UPDATE OF a':''}`, [id])).rows[0] || null;
  }
  async lockKey(db, employeeId, workDate) {
    await lockEmployee(db, employeeId);
    await db.query("SELECT pg_advisory_xact_lock(hashtext('attendance:' || $1::text || ':' || $2::text))",[employeeId,workDate]);
  }
  async batch(db, id, lock=false) {
    const row=(await db.query(`SELECT *,expires_at<=CURRENT_TIMESTAMP AS expired FROM attendance_import_batches WHERE id=$1 ${lock?'FOR UPDATE':''}`, [id])).rows[0];
    if (!row) fail('NOT_FOUND','Import batch not found.',404);
    return row;
  }
  async audit(db, actorId, action, before, after, reason=null, batchId=null) {
    await db.query(`INSERT INTO attendance_audit_logs(attendance_id,actor_id,action,reason,old_values,new_values,batch_id)
      VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7)`,[after.id,actorId,action,reason,before?JSON.stringify(before):null,JSON.stringify(after),batchId]);
    await writeAudit(db,{actorId,entityType:'attendance',entityId:after.id,action,oldValue:before,newValue:{...after,audit_reason:reason}});
  }
  async write(db, row, before, actorId, reason=null, batchId=null) {
    await assertNoLeave(db, row.employee_id, row.work_date);
    const values=[row.employee_id,row.work_date,row.work_schedule_id,row.check_in,row.check_out,row.working_minutes,
      row.late_mins,row.early_mins,row.overtime_minutes,row.outside_shift_minutes,JSON.stringify(row.schedule_snapshot),CALCULATION_VERSION,batchId];
    if (before) {
      values.push(before.id,before.version);
      const result=await db.query(`UPDATE attendance SET work_schedule_id=$3,check_in=$4::timestamptz AT TIME ZONE 'Asia/Ho_Chi_Minh',
        check_out=$5::timestamptz AT TIME ZONE 'Asia/Ho_Chi_Minh',working_minutes=$6,late_mins=$7,early_mins=$8,
        overtime_minutes=$9,outside_shift_minutes=$10,schedule_snapshot=$11::jsonb,calculation_version=$12,source_batch_id=COALESCE($13,source_batch_id),
        attendance_status='PRESENT',leave_type=NULL,version=version+1,updated_at=CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Ho_Chi_Minh'
        WHERE employee_id=$1 AND work_date=$2::date AND id=$14 AND version=$15 AND record_status='ACTIVE' RETURNING id`,values);
      if (!result.rows[0]) fail('ATTENDANCE_CONFLICT','Attendance changed; preview again.',409);
    } else {
      const result=await db.query(`INSERT INTO attendance(employee_id,work_date,work_schedule_id,check_in,check_out,working_minutes,
        late_mins,early_mins,overtime_minutes,outside_shift_minutes,schedule_snapshot,calculation_version,source_batch_id,attendance_status,record_status)
        VALUES($1,$2,$3,$4::timestamptz AT TIME ZONE 'Asia/Ho_Chi_Minh',$5::timestamptz AT TIME ZONE 'Asia/Ho_Chi_Minh',
          $6,$7,$8,$9,$10,$11::jsonb,$12,$13,'PRESENT','ACTIVE') RETURNING id`,values);
      row={...row,id:result.rows[0].id};
    }
    const after=await this.find(db,before?.id || row.id);
    await this.audit(db,actorId,before?'UPDATE':'CREATE',before,after,reason,batchId);
    return after;
  }
}
module.exports={AttendanceImportRepository,projection};
