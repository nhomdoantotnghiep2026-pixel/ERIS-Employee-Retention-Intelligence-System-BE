const { projection } = require('./attendance-import.repository');

async function readSummary(db, where, values) {
  return (await db.query(`SELECT count(*)::integer AS recorded_days,
      count(*) FILTER (WHERE attendance_status IN ('PRESENT','LATE','EARLY_LEAVE','LATE_EARLY_LEAVE'))::integer AS worked_days,
      count(DISTINCT employee_id) FILTER (WHERE attendance_status IN ('PRESENT','LATE','EARLY_LEAVE','LATE_EARLY_LEAVE'))::integer AS worked_employees,
      COALESCE(sum(working_minutes),0)::bigint AS working_minutes,
      COALESCE(sum(late_mins),0)::bigint AS late_mins,COALESCE(sum(early_mins),0)::bigint AS early_mins,
      COALESCE(sum(overtime_minutes),0)::bigint AS overtime_minutes
      FROM attendance a WHERE ${where}`,values)).rows[0];
}

async function readRecords(db, where, values, f) {
  return (await db.query(`SELECT ${projection},e.employee_code,e.full_name,
      (a.check_in IS NOT NULL AND a.check_out IS NOT NULL AND
        NOT (EXTRACT(ISODOW FROM a.work_date)::int = ANY(s.working_days))) IS TRUE AS worked_on_day_off
      FROM attendance a JOIN employees e ON e.id=a.employee_id LEFT JOIN work_schedules s ON s.id=a.work_schedule_id
      WHERE ${where} ORDER BY a.work_date DESC,a.id DESC LIMIT $4 OFFSET $5`,[...values,f.limit,f.offset])).rows;
}

async function readLogs(db, id, f) {
  return (await db.query("SELECT id,user_id AS actor_id,action,new_value->>'audit_reason' AS reason,old_value AS old_values,new_value AS new_values,created_at AS occurred_at FROM audit_logs WHERE entity_type='attendance' AND entity_id=$1 ORDER BY id DESC LIMIT $2 OFFSET $3",[id,f.limit,f.offset])).rows;
}

async function cancelRecord(db, attendanceId, reason, actorId) {
  await db.query(`UPDATE attendance SET record_status='CANCEL',cancellation_reason=$2,cancelled_by=$3,
        updated_at=CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Ho_Chi_Minh' WHERE id=$1`,[attendanceId,reason,actorId]);
}

module.exports = { readSummary, readRecords, readLogs, cancelRecord };
