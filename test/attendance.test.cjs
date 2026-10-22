const test=require('node:test'),assert=require('node:assert/strict');
const {createAttendanceService}=require('../src/modules/attendance/attendance.service');
const {AttendanceRepository}=require('../src/modules/attendance/attendance.repository');
const config={attendance:{latitude:10.845106259160106,longitude:106.83894307850271,radiusMeters:100,maxAccuracyMeters:100}};
const user={id:7,employeeId:70},gps={latitude:config.attendance.latitude,longitude:config.attendance.longitude,accuracyMeters:15};
function setup(){let now=new Date('2026-10-22T01:00:00Z'),row=null;const calls=[];
 const repository={find:async()=>row,record:async args=>{calls.push(args);row={checkIn:row?.checkIn||args.instant,checkOut:args.action==='check-out'?args.instant:null,attendanceStatus:row?.attendanceStatus||args.attendanceStatus};return row;}};
 return{service:createAttendanceService(config,repository,()=>now),setTime:v=>now=new Date(v),setRow:v=>row=v,calls};}
test('PRESENT at 08:00, LATE after 08:00; stores server instant and employee ID',async()=>{
 let x=setup();let result=await x.service.checkIn(user,gps);assert.equal(result.attendance.attendanceStatus,'PRESENT');assert.equal(x.calls[0].employeeId,70);assert.equal(x.calls[0].instant,'2026-10-22T01:00:00.000Z');assert.equal(result.storage,'postgresql');
 x=setup();x.setTime('2026-10-22T01:00:01Z');assert.equal((await x.service.checkIn(user,gps)).attendance.attendanceStatus,'LATE');
});
test('checkout uses same work date, persists and today exposes both timestamps',async()=>{
 const x=setup();await x.service.checkIn(user,gps);x.setTime('2026-10-22T10:30:00Z');await x.service.checkOut(user,gps);
 assert.equal(x.calls[1].action,'check-out');assert.equal(x.calls[1].date,'2026-10-22');const state=await x.service.today(user);assert.equal(state.checkedIn,true);assert.equal(state.checkedOut,true);assert.equal(state.showCheckInPrompt,false);assert.equal('nextCheckAt' in state,false);
});
test('100 m boundary, accuracy, GPS body and weekend block writes',async()=>{
 for(const patch of [{latitude:gps.latitude+100.1/6371000*180/Math.PI},{accuracyMeters:101}]){const x=setup();assert.equal((await x.service.checkIn(user,{...gps,...patch})).persisted,false);assert.equal(x.calls.length,0);}
 for(const patch of [{userId:99},{capturedAt:'old'},{accuracyMeters:-1},{latitude:'10'}])await assert.rejects(setup().service.checkOut(user,{...gps,...patch}),e=>e.statusCode===400);
 const x=setup();x.setTime('2026-10-24T01:00:00Z');await assert.rejects(x.service.checkIn(user,gps),e=>e.code==='NON_WORKDAY');assert.equal(x.calls.length,0);
});
test('holiday/leave today does not prompt check-in and uses Vietnam date',async()=>{
 const x=setup();x.setTime('2026-10-21T17:01:00Z');for(const attendanceStatus of ['HOLIDAY','ON_LEAVE']){x.setRow({attendanceStatus});const state=await x.service.today(user);assert.equal(state.workday,false);assert.equal(state.showCheckInPrompt,false);assert.equal(state.date,'2026-10-22');}
});
function fakeRepo(current=null,{actor=true,empty=false}={}){
 const calls=[];const client={query:async(sql,args)=>{calls.push({sql,args});if(sql.includes('FOR SHARE'))return{rows:actor?[{employee_id:70}]:[]};if(sql.includes('SELECT id, employee_id'))return{rows:current?[current]:[]};if(sql.includes('RETURNING'))return{rows:empty?[]:[{employeeId:70}]};return{rows:[]};},release:()=>calls.push({sql:'RELEASE'})};
 return{calls,repo:new AttendanceRepository({connect:async()=>client})};
}
const args={userId:7,employeeId:70,date:'2026-10-22',instant:'2026-10-22T10:30:00Z',action:'check-out'};
test('repository protects duplicate actions, missing check-in, holidays and inactive actor',async()=>{
 for(const [current,action,code] of [[null,'check-out','CHECK_IN_REQUIRED'],[{checkIn:'2026-10-22T08:00:00+07:00'},'check-in','ALREADY_CHECKED_IN'],[{checkIn:'2026-10-22T08:00:00+07:00',checkOut:'2026-10-22T17:00:00+07:00'},'check-out','ALREADY_CHECKED_OUT'],[{attendanceStatus:'HOLIDAY'},'check-in','NON_WORKDAY'],[{attendanceStatus:'ON_LEAVE'},'check-out','NON_WORKDAY']]){
 const x=fakeRepo(current);await assert.rejects(x.repo.record({...args,action}),e=>e.code===code);assert.ok(x.calls.some(c=>c.sql==='ROLLBACK'));assert.equal(x.calls.at(-1).sql,'RELEASE');assert.equal(x.calls.some(c=>c.sql==='COMMIT'),false);
 }
 const x=fakeRepo(null,{actor:false});await assert.rejects(x.repo.record(args),e=>e.statusCode===403);
});
test('checkout SQL computes minutes in DB, retains check-in/status, updates timestamp once',async()=>{
 const x=fakeRepo({checkIn:'2026-10-22T08:00:00+07:00'});await x.repo.record(args);const sql=x.calls.find(c=>c.sql.includes('WITH times')).sql;
 assert.match(sql,/working_minutes=/);assert.match(sql,/overtime_minutes=GREATEST/);assert.match(sql,/GREATEST\(a.check_in,a.work_date\+TIME '17:00'\)/);assert.doesNotMatch(sql,/overtime_minutes=CASE/);assert.match(sql,/12:00/);assert.match(sql,/13:00/);assert.match(sql,/17:00/);assert.match(sql,/updated_at=t.finish/);assert.doesNotMatch(sql,/attendance_status=/);assert.ok(x.calls.some(c=>c.sql.includes('pg_advisory_xact_lock')));assert.ok(x.calls.some(c=>c.sql==='COMMIT'));
});
test('HTTP checkout route exists and periodic location route is gone; live profile is required',async()=>{
 const express=require('express'),{createAttendanceRouter}=require('../src/modules/attendance/attendance.routes');let employeeId=70;
 const app=express();app.use(express.json());app.use('/api/v1/attendance',createAttendanceRouter({authenticate:(r,s,n)=>{r.auth={userId:7};n()},databasePool:{query:async()=>({rows:[{id:7,status:'ACTIVE',employeeId,employmentStatus:'ACTIVE'}]})},service:{checkOut:async()=>({persisted:true})}}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const url='http://127.0.0.1:'+server.address().port+'/api/v1/attendance';
 try{assert.equal((await fetch(url+'/check-out',{method:'POST'})).status,200);assert.equal((await fetch(url+'/check-location',{method:'POST'})).status,404);employeeId=null;assert.equal((await fetch(url+'/check-out',{method:'POST'})).status,403);}finally{await new Promise(r=>server.close(r));}
});
module.exports={fakeRepo,args};
