const { AppError } = require('../../common/errors/app-error');
function fail(code, message) { const error = new AppError(409, message); error.code = code; throw error; }
const columns = `id, employee_id AS "employeeId", to_char(work_date, 'YYYY-MM-DD') AS "workDate",
  to_char(check_in, 'YYYY-MM-DD"T"HH24:MI:SS.US') || '+07:00' AS "checkIn",
  to_char(check_out, 'YYYY-MM-DD"T"HH24:MI:SS.US') || '+07:00' AS "checkOut",
  working_minutes AS "workingMinutes", overtime_minutes AS "overtimeMinutes", attendance_status AS "attendanceStatus",
  to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SS.US') || '+07:00' AS "createdAt",
  to_char(updated_at, 'YYYY-MM-DD"T"HH24:MI:SS.US') || '+07:00' AS "updatedAt"`;
class AttendanceRepository {
  constructor(pool) { this.pool = pool; }
  async find(employeeId, date) {
    return (await this.pool.query(`SELECT ${columns} FROM public.attendance WHERE employee_id=$1 AND work_date=$2::date`, [employeeId, date])).rows[0] || null;
  }
  async record({ userId, employeeId, date, instant, action, attendanceStatus }) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: actors } = await client.query(`SELECT u.employee_id FROM users u JOIN employees e ON e.id=u.employee_id
        WHERE u.id=$1 AND u.employee_id=$2 AND u.status='ACTIVE' AND e.employment_status='ACTIVE' FOR SHARE OF u,e`, [userId, employeeId]);
      if (!actors[0]) throw new AppError(403, 'An ACTIVE linked employee profile is required.');
      await client.query(`SELECT pg_advisory_xact_lock(hashtext('attendance:' || $1::text || ':' || $2::text))`, [employeeId,date]);
      const repository = new AttendanceRepository(client);
      const current = await repository.find(employeeId,date);
      if (['ON_LEAVE','HOLIDAY'].includes(current?.attendanceStatus)) fail('NON_WORKDAY', 'Attendance is marked ON_LEAVE or HOLIDAY.');
      let result;
      if (action === 'check-in') {
        if (current?.checkIn || current?.checkOut) fail('ALREADY_CHECKED_IN', 'Already checked in for this work date.');
        result = await client.query(`INSERT INTO public.attendance
          (employee_id,work_date,check_in,working_minutes,overtime_minutes,attendance_status,created_at,updated_at)
          VALUES ($1,$2::date,$3::timestamptz AT TIME ZONE 'Asia/Ho_Chi_Minh',0,0,$4,
            $3::timestamptz AT TIME ZONE 'Asia/Ho_Chi_Minh',$3::timestamptz AT TIME ZONE 'Asia/Ho_Chi_Minh')
          ON CONFLICT (employee_id,work_date) DO UPDATE SET check_in=EXCLUDED.check_in,
            working_minutes=0,overtime_minutes=0,attendance_status=EXCLUDED.attendance_status,updated_at=EXCLUDED.updated_at
          WHERE attendance.check_in IS NULL AND attendance.check_out IS NULL AND attendance.attendance_status NOT IN ('ON_LEAVE','HOLIDAY')
          RETURNING ${columns}`, [employeeId,date,instant,attendanceStatus]);
      } else {
        if (!current?.checkIn) fail('CHECK_IN_REQUIRED','Check in before checking out.');
        if (current.checkOut) fail('ALREADY_CHECKED_OUT','Already checked out for this work date.');
        if (new Date(instant) < new Date(current.checkIn)) fail('INVALID_CHECK_OUT','Check-out cannot precede check-in.');
        result = await client.query(`WITH times AS (
          SELECT $3::timestamptz AT TIME ZONE 'Asia/Ho_Chi_Minh' AS finish
        ) UPDATE public.attendance a SET check_out=t.finish,
          working_minutes=GREATEST(0,FLOOR(EXTRACT(EPOCH FROM (t.finish-a.check_in)) / 60
            - GREATEST(0,EXTRACT(EPOCH FROM (LEAST(t.finish,a.work_date+TIME '13:00')
                - GREATEST(a.check_in,a.work_date+TIME '12:00'))) / 60)))::integer,
          overtime_minutes=GREATEST(0,FLOOR(EXTRACT(EPOCH FROM (t.finish-GREATEST(a.check_in,a.work_date+TIME '17:00'))) / 60))::integer,
          updated_at=t.finish FROM times t
          WHERE a.employee_id=$1 AND a.work_date=$2::date AND a.check_out IS NULL AND a.check_in IS NOT NULL
          RETURNING ${columns.replace(/^id,/, 'a.id,')}`,
          [employeeId,date,instant]);
      }
      if (!result.rows[0]) fail('ATTENDANCE_CONFLICT','Attendance was changed; reload and try again.');
      await client.query('COMMIT'); return result.rows[0];
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
}
module.exports = { AttendanceRepository };
