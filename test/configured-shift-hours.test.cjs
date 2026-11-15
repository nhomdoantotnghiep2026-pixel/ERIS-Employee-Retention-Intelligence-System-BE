const test=require('node:test'),assert=require('node:assert/strict');
const {validateAgainstSchedule}=require('../src/modules/attendance/import-schedule.validation');
const {validate}=require('../src/modules/attendance/attendance.import');
const {validateCreateScheduleInput}=require('../src/modules/work-schedules/work-schedules.validation');
const shift={name:'Office',shift_type:'office',start_time:'09:00:00',end_time:'18:00:00',break_start:'12:00:00',break_end:'13:00:00',working_days:[1,2,3,4,5],status:'ACTIVE'};
const row=(changes={})=>({errors:[],data:{employee_id:'EMP009',attendance_date:'2026-11-09',shift_type:'office',attendance_status:'PRESENT',login_timestamp:'2026-11-09 09:00:00',logout_timestamp:'2026-11-09 18:00:00',total_hours_worked:8,late_arrival_mins:0,early_exit_mins:0,overtime_hours:0,leave_type:null,...changes}});
function run(changes={},schedule=shift){const r=row(changes);validate(r);if(!r.errors.length)validateAgainstSchedule(r,schedule);return r;}
test('09-18 uses 18:00, not 17:00 as OT threshold',()=>{
 assert.deepEqual(run().errors,[]);
 const early=run({logout_timestamp:'2026-11-09 17:30:00',attendance_status:'EARLY_LEAVE',early_exit_mins:30,total_hours_worked:7.5});assert.deepEqual(early.errors,[]);assert.equal(early.expected.overtime_hours,0);
 const wrong=run({logout_timestamp:'2026-11-09 17:30:00',attendance_status:'EARLY_LEAVE',early_exit_mins:30,total_hours_worked:7.5,overtime_hours:0.5});assert.ok(wrong.errors.some(e=>e.field==='overtime_hours'&&e.expected===0));
 assert.deepEqual(run({logout_timestamp:'2026-11-09 19:00:00',total_hours_worked:9,overtime_hours:1}).errors,[]);
});
test('daily net hours derive from shift length and break, not a fixed eight hours',()=>{
 assert.deepEqual(run({total_hours_worked:9},{...shift,break_start:null,break_end:null}).errors,[]);
 assert.deepEqual(run({logout_timestamp:'2026-11-09 19:00:00',total_hours_worked:9},{...shift,end_time:'19:00:00'}).errors,[]);
 assert.deepEqual(run({logout_timestamp:'2026-11-09 15:00:00',total_hours_worked:6},{...shift,end_time:'15:00:00',break_start:null,break_end:null}).errors,[]);
 const wrong=run({total_hours_worked:9});assert.ok(wrong.errors.some(e=>e.field==='total_hours_worked'&&e.expected===8));
});
test('each employee shift defines its own OT; break overlap, late arrival after shift, boundaries',()=>{
 assert.deepEqual(run({logout_timestamp:'2026-11-09 17:30:00',total_hours_worked:7.5,overtime_hours:0.5},{...shift,end_time:'17:00:00'}).errors,[]);
 assert.deepEqual(run({login_timestamp:'2026-11-09 12:30:00',attendance_status:'LATE',late_arrival_mins:210,total_hours_worked:5}).errors,[]);
 const early=run({login_timestamp:'2026-11-09 08:00:00',total_hours_worked:9});assert.deepEqual(early.errors,[]);assert.equal(early.expected.overtime_hours,0);assert.equal(early.warnings[0].minutes,60);
 const late=run({login_timestamp:'2026-11-09 09:00:30',attendance_status:'LATE',late_arrival_mins:0});assert.deepEqual(late.errors,[]);
 const outside=run({login_timestamp:'2026-11-09 19:00:00',logout_timestamp:'2026-11-09 20:00:00',attendance_status:'LATE',late_arrival_mins:600,total_hours_worked:1,overtime_hours:1});assert.ok(outside.errors.some(e=>e.code==='OUTSIDE_SHIFT'));
});
test('create and import enforce the same break-pair and day validation',()=>{
 const noBreak=validateCreateScheduleInput({...shift,break_start:null,break_end:null});assert.equal(noBreak.break_start,null);
 for(const schedule of [{...shift,break_end:null},{...shift,break_start:null},{...shift,break_start:'18:30:00',break_end:'19:00:00'},{...shift,working_days:[1,1]},{...shift,working_days:[0]},{...shift,end_time:'08:00:00'}]){
 assert.throws(()=>validateCreateScheduleInput(schedule));assert.ok(run({},schedule).errors.some(e=>e.code==='INVALID_SCHEDULE'));
 }
});
