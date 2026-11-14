const { AppError } = require('../../common/errors/app-error');

// The current schema has one schedule FK on employees, without dated history.
// Keep the date parameter for existing callers, but never infer historical assignments.
function scheduleSql(employee, date) {
  return `SELECT s.id,s.name,s.start_time,s.end_time,s.break_start,s.break_end,s.working_days,s.status,
    NULL::integer AS assignment_id,'EMPLOYEE_CURRENT'::text AS source
    FROM employees schedule_employee JOIN work_schedules s ON s.id=schedule_employee.work_schedule_id
    WHERE schedule_employee.id=${employee} AND ${date} IS NOT NULL`;
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
    const error=new AppError(409,'No active employee work schedule is configured. Ask HR to set employees.work_schedule_id.');
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
  const breakStart=schedule.breakStart==null?shiftStart:at(date,schedule.breakStart),breakEnd=schedule.breakEnd==null?shiftStart:at(date,schedule.breakEnd);
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
