// A schedule defines the boundaries. No fixed daily-hour or overtime threshold.
function seconds(value){
 if(typeof value!=='string'||!/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,6})?)?$/.test(value))return NaN;
 const [h,m,s=0]=value.split(':').map(Number);return h*3600+m*60+s;
}
function scheduleRules(schedule){
 const start=seconds(schedule.start_time),end=seconds(schedule.end_time);
 const noBreak=schedule.break_start==null&&schedule.break_end==null;
 const breakStart=noBreak?start:seconds(schedule.break_start),breakEnd=noBreak?start:seconds(schedule.break_end);
 const days=schedule.working_days;
 if(![start,end,breakStart,breakEnd].every(Number.isFinite)||start>=end||(!noBreak&&!(start<breakStart&&breakStart<breakEnd&&breakEnd<end))||!Array.isArray(days)||!days.length||days.some(d=>!Number.isInteger(d)||d<1||d>7)||new Set(days).size!==days.length) return null;
 return {start,end,breakStart,breakEnd,noBreak,scheduledHours:(end-start-breakEnd+breakStart)/3600};
}
module.exports={scheduleRules};
