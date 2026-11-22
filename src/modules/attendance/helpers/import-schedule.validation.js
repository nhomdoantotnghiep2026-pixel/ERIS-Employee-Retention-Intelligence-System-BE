// All timestamps and shift times are interpreted as Vietnam wall-clock time.
const minute=60000;
const {scheduleRules}=require('./shift-rules');
const timestamp=v=>new Date(v.replace(' ','T')+'+07:00').getTime();
const overlap=(a,b,c,d)=>Math.max(0,Math.min(b,d)-Math.max(a,c));
function validateAgainstSchedule(row,schedule){
 const d=row.data;row.warnings ||= [];
 const issue=(field,code,message,expected)=>row.errors.push({field,code,message,provided:d[field],...(expected!==undefined?{expected}:{})});
 if(schedule.shift_type!==d.shift_type){issue('shift_type','SHIFT_MISMATCH','Shift type does not match the employee schedule.',schedule.shift_type);return;}
 const day=d.attendance_date;
 const rules=scheduleRules(schedule);
 if(!rules){issue('shift_type','INVALID_SCHEDULE','Assigned schedule has invalid times, break pair or working days. HR must correct its configuration.');return;}
 const midnight=timestamp(day+' 00:00:00');
 const start=midnight+rules.start*1000,end=midnight+rules.end*1000,bs=midnight+rules.breakStart*1000,be=midnight+rules.breakEnd*1000;
 const weekday=new Date(day+'T00:00:00Z').getUTCDay()||7;
 if(!schedule.working_days.includes(weekday)&&d.attendance_status!=='HOLIDAY'){issue('attendance_date','NON_WORKDAY','Date is outside the assigned working days; confirm the correct source or schedule before import.',schedule.working_days);return;}
 if(['ABSENT','ON_LEAVE','HOLIDAY'].includes(d.attendance_status))return;
 const login=timestamp(d.login_timestamp),logout=timestamp(d.logout_timestamp);
 const late=Math.max(0,Math.floor((login-start)/minute)),early=Math.max(0,Math.floor((end-logout)/minute));
 const status=login>start?(logout<end?'LATE_EARLY_LEAVE':'LATE'):(logout<end?'EARLY_LEAVE':'PRESENT');
 if(d.attendance_status!==status)issue('attendance_status','STATUS_MISMATCH','Status disagrees with login/logout relative to shift start/end.',status);
 const expected={late_arrival_mins:late,early_exit_mins:early,
 total_hours_worked:(logout-login-overlap(login,logout,bs,be))/3600000,
 overtime_hours:Math.max(0,logout-Math.max(login,end)-overlap(Math.max(login,end),logout,bs,be))/3600000};
 for(const [field,n] of Object.entries(expected)){
  // Decimal hours rounded to two places may differ by less than a minute.
  const tolerance=field.endsWith('mins')?0:1/60;
  if(Math.abs(d[field]-n)>tolerance+1e-9)issue(field,'METRIC_MISMATCH','Reported value disagrees with shift-based calculation.',field.endsWith('mins')?n:Number(n.toFixed(4)));
 }
 if(login<start)row.warnings.push({field:'login_timestamp',code:'EARLY_ARRIVAL',message:'Employee arrived before shift start. Time before the shift is not counted as overtime.',minutes:Math.floor((start-login)/minute)});
 if(logout<=start||login>=end)issue('login_timestamp','OUTSIDE_SHIFT','Attendance interval does not overlap the assigned shift.');
 row.expected=Object.fromEntries(Object.entries(expected).map(([k,v])=>[k,Number(v.toFixed(4))]));
}
module.exports={validateAgainstSchedule};
