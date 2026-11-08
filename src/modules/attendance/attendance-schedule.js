const { AppError } = require('../../common/errors/app-error');

// Dates at both ends of an assignment are inclusive. A matching assignment
// takes precedence even when its schedule is inactive (never silently fall back).
function scheduleSql(employee, date) {
  return `SELECT chosen.* FROM (
    SELECT s.id,s.name,s.start_time,s.end_time,s.break_start,s.break_end,s.working_days,s.status,
      a.id AS assignment_id,'ASSIGNMENT'::text AS source,0 AS priority
    FROM employee_schedule_assignments a JOIN work_schedules s ON s.id=a.schedule_id
    WHERE a.employee_id=${employee} AND a.effective_from<=${date}
      AND (a.effective_to IS NULL OR a.effective_to>=${date})
    UNION ALL
    SELECT s.id,s.name,s.start_time,s.end_time,s.break_start,s.break_end,s.working_days,s.status,
      NULL::integer AS assignment_id,'DEFAULT'::text AS source,1 AS priority
    FROM work_schedules s WHERE s.is_default=TRUE AND s.status='ACTIVE'
  ) chosen ORDER BY priority,assignment_id DESC NULLS LAST LIMIT 1`;
}
async function resolveSchedule(db,employeeId,date) {
  const {rows}=await db.query(scheduleSql('$1::integer','$2::date'),[employeeId,date]);
  const row=rows[0];
  return row && row.status==='ACTIVE' ? {
    id:row.id,name:row.name,assignmentId:row.assignment_id,source:row.source,
    startTime:row.start_time,endTime:row.end_time,breakStart:row.break_start,breakEnd:row.break_end,
    workingDays:row.working_days
  } : null;
}
function requireSchedule(schedule) {
  if(!schedule) {
    const error=new AppError(409,'No active work schedule applies to this date. Ask HR to assign a schedule or set an active default.');
    error.code='SCHEDULE_NOT_CONFIGURED';throw error;
  }
  return schedule;
}
function isScheduledDay(date,schedule) {
  const day=new Date(date+'T00:00:00Z').getUTCDay() || 7;
  return !!schedule?.workingDays.includes(day);
}
function at(date,time) {return new Date(date+'T'+time+'+07:00').getTime();}
function overlap(start,end,breakStart,breakEnd) {
  return Math.max(0,Math.min(end,breakEnd)-Math.max(start,breakStart));
}
function calculateAttendance(date,checkIn,checkOut,schedule) {
  const start=new Date(checkIn).getTime(),finish=new Date(checkOut).getTime();
  const shiftStart=at(date,schedule.startTime),shiftEnd=at(date,schedule.endTime);
  const breakStart=at(date,schedule.breakStart),breakEnd=at(date,schedule.breakEnd);
  const overtimeStart=Math.max(start,shiftEnd);
  const late=start>shiftStart,early=finish<shiftEnd;
  return {
    attendanceStatus:late?(early?'LATE_EARLY_LEAVE':'LATE'):(early?'EARLY_LEAVE':'PRESENT'),
    // Retain the existing contract: workingMinutes includes overtime.
    workingMinutes:Math.max(0,Math.floor((finish-start-overlap(start,finish,breakStart,breakEnd))/60000)),
    overtimeMinutes:Math.max(0,Math.floor((finish-overtimeStart-overlap(overtimeStart,finish,breakStart,breakEnd))/60000))
  };
}
module.exports={scheduleSql,resolveSchedule,requireSchedule,isScheduledDay,calculateAttendance,at};
