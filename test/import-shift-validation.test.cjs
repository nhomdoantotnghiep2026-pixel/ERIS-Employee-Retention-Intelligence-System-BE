const test=require('node:test'),assert=require('node:assert/strict');
const {validateAgainstSchedule}=require('../src/modules/attendance/import-schedule.validation');
const {validateCreateScheduleInput,validateAssignmentInput,validateCreateIndividual,prepareScheduleUpdate}=require('../src/modules/work-schedules/work-schedules.validation');
const schedule={id:1,name:'Mid shift',shift_type:'mid',start_time:'11:00:00',end_time:'20:00:00',break_start:'15:00:00',break_end:'16:00:00',working_days:[1,2,3,4,5],status:'ACTIVE'};
function fixture(changes={}){return {errors:[],data:{employee_id:'EMP01',attendance_date:'2025-01-02',shift_type:'mid',attendance_status:'PRESENT',login_timestamp:'2025-01-02 11:00:00',logout_timestamp:'2025-01-02 20:00:00',total_hours_worked:8,overtime_hours:0,late_arrival_mins:0,early_exit_mins:0,...changes}};}
test('MID example reports early departure, incorrect PRESENT, total hours and early arrival',()=>{
 const r=fixture({login_timestamp:'2025-01-02 09:30:00',logout_timestamp:'2025-01-02 17:30:00',total_hours_worked:8});validateAgainstSchedule(r,schedule);
 assert.ok(r.errors.some(e=>e.field==='attendance_status'&&e.expected==='EARLY_LEAVE'));
 assert.ok(r.errors.some(e=>e.field==='early_exit_mins'&&e.expected===150));assert.ok(r.errors.some(e=>e.field==='total_hours_worked'&&e.expected===7));assert.equal(r.warnings[0].minutes,90);
});
test('valid PRESENT, late/early combined, partial break and rounded overtime',()=>{
 for(const changes of [{},{login_timestamp:'2025-01-02 11:30:00',logout_timestamp:'2025-01-02 19:30:00',attendance_status:'LATE_EARLY_LEAVE',late_arrival_mins:30,early_exit_mins:30,total_hours_worked:7},{logout_timestamp:'2025-01-02 20:20:00',total_hours_worked:8.33,overtime_hours:0.33},{logout_timestamp:'2025-01-02 15:30:00',attendance_status:'EARLY_LEAVE',early_exit_mins:270,total_hours_worked:4}]){const r=fixture(changes);validateAgainstSchedule(r,schedule);assert.deepEqual(r.errors,[]);}
});
test('bad shift, invalid schedule, off-day and outside shift fail; holiday zero hours allowed',()=>{
 for(const [changes,s] of [[{shift_type:'day'},schedule],[{}, {...schedule,end_time:'09:00:00'}],[{attendance_date:'2025-01-04'},schedule],[{login_timestamp:'2025-01-02 08:00:00',logout_timestamp:'2025-01-02 10:00:00'},schedule]]){const r=fixture(changes);validateAgainstSchedule(r,s);assert.ok(r.errors.length);}
 const r=fixture({attendance_date:'2025-01-04',attendance_status:'HOLIDAY'});validateAgainstSchedule(r,schedule);assert.deepEqual(r.errors,[]);
});
test('new schedule/assignment payload validates shift type and rejects unsupported date ranges',()=>{
 const {id,...input}=schedule;assert.equal(validateCreateScheduleInput(input).shift_type,'mid');
 assert.deepEqual(validateAssignmentInput({work_schedule_id:1}),{work_schedule_id:1});
 for(const body of [{schedule_id:1},{work_schedule_id:1,effective_from:'2025-01-01'},{work_schedule_id:0}])assert.throws(()=>validateAssignmentInput(body));
 assert.equal(validateCreateIndividual({...input,employee_id:10}).employeeId,10);
 assert.throws(()=>validateCreateScheduleInput({...input,working_days:[1,1]}));
 assert.throws(()=>prepareScheduleUpdate(input,true,{start_time:'10:00:00'}));
});
