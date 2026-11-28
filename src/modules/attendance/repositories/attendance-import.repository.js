const { workWarnings } = require('../../holidays/holidays.service');
const { lockEmployee, assertNoLeave } = require('../../leave-records/leave-records.repository');
const { fail } = require('../helpers/attendance-import.rules');
const { writeAudit } = require('../../audit_logs/repositories/audit.repository');
// Format local timestamps in SQL; pg's host timezone must never change their meaning.
const projection = `a.*, a.work_date::text AS work_date,
  to_char(a.check_in,'YYYY-MM-DD"T"HH24:MI:SS') || '+07:00' AS check_in,
  to_char(a.check_out,'YYYY-MM-DD"T"HH24:MI:SS') || '+07:00' AS check_out,
  to_char(a.created_at,'YYYY-MM-DD"T"HH24:MI:SS') || '+07:00' AS created_at,
  to_char(a.updated_at,'YYYY-MM-DD"T"HH24:MI:SS') || '+07:00' AS updated_at`;
class AttendanceImportRepository {
  constructor(pool) { this.pool = pool; }
  async transaction(work) {
    const client = await this.pool.connect();
    try { await client.query('BEGIN'); const result = await work(client); await client.query('COMMIT'); return result; }
    catch (e) { await client.query('ROLLBACK'); throw e; }
    finally { client.release(); }
  }
  async actor(db, userId, hr = false, lock = false) {
    const { rows } = await db.query(`SELECT u.id,u.status,u.employee_id AS "employeeId",r.name AS role_name
      FROM users u JOIN role r ON r.id=u.role_id WHERE u.id=$1 ${lock ? 'FOR SHARE OF u,r' : ''}`, [userId]);
    const u = rows[0];
    if (!u || u.status !== 'ACTIVE') fail('UNAUTHORIZED', 'An active account is required.', 401);
    if (hr && u.role_name !== 'HR') fail('FORBIDDEN', 'Only HR can manage attendance.', 403);
    return u;
  }
  async references(db) {
    const employees = (await db.query('SELECT id,employee_code,full_name,hire_date::text,work_schedule_id,employment_status FROM employees')).rows;
    const schedules = (await db.query('SELECT * FROM work_schedules WHERE shift_type IS NOT NULL ORDER BY id')).rows;
    return { employees, schedules };
  }
  async current(db, employeeId, workDate, lock = false) {
    return (await db.query(`SELECT ${projection} FROM attendance a WHERE employee_id=$1 AND work_date=$2::date AND record_status='ACTIVE' ${lock ? 'FOR UPDATE' : ''}`, [employeeId, workDate])).rows[0] || null;
  }
  async calendarSources(db, from, to, employeeIds) {
    const [holidays, leaves] = await Promise.all([
      db.query("SELECT id,start_date::text,end_date::text FROM holidays WHERE status='ACTIVE' AND start_date<=$2 AND end_date>=$1 ORDER BY id", [from, to]),
      db.query("SELECT id,employee_id,start_date::text,end_date::text FROM employee_leave_records WHERE record_status='ACTIVE' AND employee_id=ANY($3::int[]) AND start_date<=$2 AND end_date>=$1 ORDER BY id", [from, to, employeeIds])
    ]);
    return { holidays: holidays.rows, leaves: leaves.rows };
  }
  async find(db, id, lock = false) {
    return (await db.query(`SELECT ${projection},e.employee_code,e.full_name FROM attendance a JOIN employees e ON e.id=a.employee_id
      WHERE a.id=$1 ${lock ? 'FOR UPDATE OF a' : ''}`, [id])).rows[0] || null;
  }
  async findScheduledShift(db, attendanceId, scheduleId) {
    const { rows } = await db.query(`
      SELECT 'SNAPSHOT' AS source,
        snapshot->>'shift_type' AS shift_type,
        snapshot->>'start_time' AS start_time, snapshot->>'end_time' AS end_time,
        snapshot->>'break_start' AS break_start, snapshot->>'break_end' AS break_end
      FROM (
        SELECT new_value->'calculation_schedule' AS snapshot
        FROM audit_logs
        WHERE entity_type='attendance' AND entity_id=$1 AND action='CREATE'
          AND jsonb_typeof(new_value::jsonb->'calculation_schedule'->'start_time')='string'
          AND jsonb_typeof(new_value::jsonb->'calculation_schedule'->'end_time')='string'
        ORDER BY id DESC LIMIT 1
      ) AS saved
      UNION ALL
      SELECT 'CATALOG', shift_type::text, start_time::text, end_time::text,
        break_start::text, break_end::text
      FROM work_schedules WHERE id=$2
      ORDER BY source DESC LIMIT 1`, [attendanceId, scheduleId ?? null]);
    return rows[0] ?? null;
  }
  async cancellations(db, {employeeId, from, to, limit, offset}, id) {
    const {rows}=await db.query(`SELECT ${projection},e.employee_code,e.full_name,
      s.name AS schedule_name,s.shift_type,
      COALESCE(a.cancelled_by,log.user_id) AS cancelled_by,u.full_name AS cancelled_by_name,
      COALESCE(a.cancellation_reason,log.reason) AS cancellation_reason,log.created_at AS cancelled_at
      FROM attendance a JOIN employees e ON e.id=a.employee_id
      LEFT JOIN work_schedules s ON s.id=a.work_schedule_id
      LEFT JOIN LATERAL (
        SELECT user_id,created_at,new_value->>'audit_reason' AS reason
        FROM audit_logs WHERE lower(entity_type)='attendance' AND entity_id=a.id AND action='CANCEL'
        ORDER BY id DESC LIMIT 1
      ) log ON true
      LEFT JOIN users u ON u.id=COALESCE(a.cancelled_by,log.user_id)
      WHERE a.record_status='CANCEL' AND ($1::bigint IS NULL OR a.id=$1)
        AND ($2::integer IS NULL OR a.employee_id=$2)
        AND ($3::date IS NULL OR a.work_date>=$3) AND ($4::date IS NULL OR a.work_date<=$4)
      ORDER BY log.created_at DESC NULLS LAST,a.id DESC LIMIT $5 OFFSET $6`,[id,employeeId,from,to,limit,offset]);
    return rows;
  }
  async lockKey(db, employeeId, workDate) {
    await lockEmployee(db, employeeId);
    await db.query("SELECT pg_advisory_xact_lock(hashtext('attendance:' || $1::text || ':' || $2::text))", [employeeId, workDate]);
  }
  async audit(db, actorId, action, before, after, reason = null) {
    await writeAudit(db, { actorId, entityType: 'attendance', entityId: after.id, action, oldValue: before, newValue: { ...after, audit_reason: reason } });
  }
  async overlapping(db, employeeId, checkIn, checkOut) {
    return (await db.query(`SELECT id,work_date::text FROM attendance WHERE employee_id=$1 AND record_status='ACTIVE'
      AND check_in < ($3::timestamptz AT TIME ZONE 'Asia/Ho_Chi_Minh')
      AND check_out > ($2::timestamptz AT TIME ZONE 'Asia/Ho_Chi_Minh')`, [employeeId, checkIn, checkOut])).rows;
  }
  async write(db, row, before, actorId, reason = null) {
    if (before) fail('ATTENDANCE_CONFLICT', 'Cancel the existing ACTIVE attendance first.', 409);
    if (row.check_in || row.check_out) await assertNoLeave(db, row.employee_id, row.work_date);
    const values = [row.employee_id, row.work_date, row.work_schedule_id, row.check_in, row.check_out, row.working_minutes,
    row.late_mins, row.early_mins, row.overtime_minutes, row.attendance_status || 'PRESENT'];
    const result = await db.query(`INSERT INTO attendance(employee_id,work_date,work_schedule_id,check_in,check_out,working_minutes,
      late_mins,early_mins,overtime_minutes,attendance_status,record_status)
      VALUES($1,$2,$3,$4::timestamptz AT TIME ZONE 'Asia/Ho_Chi_Minh',$5::timestamptz AT TIME ZONE 'Asia/Ho_Chi_Minh',
        $6,$7,$8,$9,$10,'ACTIVE') RETURNING id`, values);
    if (!result.rows.length) fail('STALE_PREVIEW', 'Attendance changed; preview again.', 409);
    const after = await this.find(db, result.rows[0].id);
    after.holiday_warnings = row.check_in && row.check_out ? await workWarnings(db, row.employee_id, row.check_in, row.check_out) : [];
    await this.audit(db, actorId, 'CREATE', null, {
      ...after, ...(row.derived_source ? { derived_source: row.derived_source } : {}),
      ...(row.schedule_snapshot ? { calculation_schedule: row.schedule_snapshot } : {})
    }, reason);
    return after;
  }
}
module.exports = { AttendanceImportRepository, projection };
