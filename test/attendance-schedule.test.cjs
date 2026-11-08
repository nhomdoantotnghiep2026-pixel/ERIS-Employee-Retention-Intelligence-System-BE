const test=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const {databasePool}=require('../src/config/database');
const {AttendanceRepository}=require('../src/modules/attendance/attendance.repository');
const {LeaveRequestsRepository}=require('../src/modules/attendance/leave-requests.repository');
const {createAttendanceService}=require('../src/modules/attendance/attendance.service');
const {calculateAttendance}=require('../src/modules/attendance/attendance-schedule');
const {createAttendanceRouter}=require('../src/modules/attendance/attendance.routes');

test('schedule calculations subtract only overlapping lunch, preserve overtime contract',()=>{
 const schedule={startTime:'08:30:00',endTime:'17:30:00',breakStart:'12:30:00',breakEnd:'13:30:00'};
 const calc=(start,end)=>calculateAttendance('2026-11-09',`2026-11-09T${start}:00+07:00`,`2026-11-09T${end}:00+07:00`,schedule);
 assert.deepEqual(calc('08:30','17:30'),{attendanceStatus:'PRESENT',workingMinutes:480,overtimeMinutes:0});
 assert.deepEqual(calc('08:31','17:29'),{attendanceStatus:'LATE_EARLY_LEAVE',workingMinutes:478,overtimeMinutes:0});
 assert.deepEqual(calc('08:30','18:00'),{attendanceStatus:'PRESENT',workingMinutes:510,overtimeMinutes:30});
 assert.equal(calc('11:45','12:45').workingMinutes,45);
 assert.equal(calc('13:15','14:15').workingMinutes,45);
 assert.equal(calc('12:45','13:15').workingMinutes,0);
 assert.equal(calc('08:30','11:30').workingMinutes,180);
 assert.equal(calc('18:00','20:00').overtimeMinutes,120);
});

test('PostgreSQL TEMP: schedule priority, dates, check-in/out, weekends, leave and absence',async()=>{
 const client=await databasePool.connect();
 let server;
 const query=(sql,args)=>client.query(sql.replaceAll('public.attendance','attendance'),args);
 const pool={query,connect:async()=>({query,release(){}})};
 try{
  await client.query("SET statement_timeout TO '10s'");
  for(const name of ['role','employees','users','attendance','employee_job_histories','work_schedules','employee_schedule_assignments','leave_requests','leave_request_histories']){
   await client.query(`CREATE TEMP TABLE ${name} (LIKE public.${name} INCLUDING ALL)`);
  }
  // Every application read/write below resolves only to TEMP tables, never production.
  await client.query('SET search_path TO pg_temp');
  const schedule=async(name,start,end,lunchStart,lunchEnd,days,defaultValue=false)=>
   (await client.query(`INSERT INTO work_schedules(name,start_time,end_time,break_start,break_end,working_days,status,is_default)
     VALUES($1,$2,$3,$4,$5,$6,'ACTIVE',$7) RETURNING id`,[name,start,end,lunchStart,lunchEnd,days,defaultValue])).rows[0].id;
  const normal=await schedule('Office','08:00','17:00','12:00','13:00',[1,2,3,4,5],true);
  const delayed=await schedule('Delayed 30 min','08:30','17:30','12:30','13:30',[1,2,3,4,5,6]);
  const role=(await client.query("INSERT INTO role(name) VALUES('EMPLOYEE') RETURNING id")).rows[0].id;
  const person=async n=>{
   const id=(await client.query("INSERT INTO employees(employee_code,full_name,hire_date,employment_status) VALUES($1,$2,'2020-01-01','ACTIVE') RETURNING id",['SCHEDULE'+n,'Schedule test '+n])).rows[0].id;
   const account=(await client.query("INSERT INTO users(email,password,role_id,status,employee_id) VALUES($1,'hash',$2,'ACTIVE',$3) RETURNING id",[`schedule${n}@test.invalid`,role,id])).rows[0].id;
   await client.query("INSERT INTO employee_job_histories(employee_id,change_type,start_date,created_at) VALUES($1,'HIRE','2020-01-01','2020-01-01')",[id]);
   return {id:account,employeeId:id,status:'ACTIVE',employmentStatus:'ACTIVE',role_name:'EMPLOYEE'};
  };
  const employee=await person(1),other=await person(2);
  await client.query("INSERT INTO employee_schedule_assignments(employee_id,schedule_id,effective_from,effective_to) VALUES($1,$2,'2026-11-09','2026-11-14')",[employee.employeeId,delayed]);
  const repo=new AttendanceRepository(pool),leaveRepo=new LeaveRequestsRepository(pool);
  let now=new Date('2026-11-09T08:30:00+07:00');
  const holidays=new Map();
  const service=createAttendanceService({attendance:{latitude:0,longitude:0,radiusMeters:100,maxAccuracyMeters:100}},repo,()=>now,null,{holiday:async d=>holidays.get(d)},leaveRepo);
  const gps={latitude:0,longitude:0,accuracyMeters:10};
  assert.equal((await repo.getSchedule(employee.employeeId,'2026-11-08')).id,normal);
  assert.equal((await repo.getSchedule(employee.employeeId,'2026-11-09')).id,delayed);
  assert.equal((await repo.getSchedule(employee.employeeId,'2026-11-14')).id,delayed);
  assert.equal((await repo.getSchedule(employee.employeeId,'2026-11-15')).id,normal);
  assert.equal((await repo.getSchedule(other.employeeId,'2026-11-09')).source,'DEFAULT');
  let data=await service.checkIn(employee,gps);
  assert.equal(data.persisted,true);assert.equal(data.attendance.attendanceStatus,'PRESENT');
  assert.equal((await repo.find(employee.employeeId,'2026-11-09')).checkIn.slice(11,16),'08:30');
  await assert.rejects(()=>service.checkIn(employee,gps),e=>e.code==='ALREADY_CHECKED_IN');
  assert.equal((await service.configuration(employee)).workEnd,'17:30:00');
  const app=express();app.use(express.json());
  app.use('/api/v1/attendance',createAttendanceRouter({service,databasePool:pool,authenticate:(req,res,next)=>{req.auth={userId:employee.id};next();}}));
  app.use((e,req,res,next)=>res.status(e.statusCode||500).json({message:e.message}));
  await new Promise(resolve=>{server=app.listen(0,'127.0.0.1',resolve);});
  const response=await fetch(`http://127.0.0.1:${server.address().port}/api/v1/attendance/config`);
  assert.equal(response.status,200);
  const config=await response.json();assert.equal(config.workStart,'08:30:00');assert.equal(config.lunchStart,'12:30:00');
  assert.equal(config.schedule.source,'ASSIGNMENT');
  assert.equal((await service.today(employee)).schedule.assignmentId!=null,true);
  now=new Date('2026-11-09T17:30:00+07:00');
  data=await service.checkOut(employee,gps);
  assert.equal(data.attendance.attendanceStatus,'PRESENT');
  assert.equal(data.attendance.workingMinutes,480);assert.equal(data.attendance.overtimeMinutes,0);
  await assert.rejects(()=>service.checkOut(employee,gps),e=>e.code==='ALREADY_CHECKED_OUT');
  now=new Date('2026-11-10T08:31:00+07:00');await service.checkIn(employee,gps);
  now=new Date('2026-11-10T17:29:00+07:00');data=await service.checkOut(employee,gps);
  assert.equal(data.attendance.attendanceStatus,'LATE_EARLY_LEAVE');
  assert.equal(data.attendance.workingMinutes,478);
  now=new Date('2026-11-11T08:30:00+07:00');await service.checkIn(employee,gps);
  now=new Date('2026-11-11T18:00:00+07:00');data=await service.checkOut(employee,gps);
  assert.equal(data.attendance.workingMinutes,510);assert.equal(data.attendance.overtimeMinutes,30);
  now=new Date('2026-11-12T18:00:00+07:00');await service.checkIn(employee,gps);
  now=new Date('2026-11-12T20:00:00+07:00');data=await service.checkOut(employee,gps);
  assert.equal(data.attendance.workingMinutes,120);assert.equal(data.attendance.overtimeMinutes,120);
  now=new Date('2026-11-13T12:45:00+07:00');await service.checkIn(employee,gps);
  now=new Date('2026-11-13T13:15:00+07:00');data=await service.checkOut(employee,gps);
  assert.equal(data.attendance.workingMinutes,0);assert.equal(data.attendance.overtimeMinutes,0);
  now=new Date('2026-11-14T08:30:00+07:00');
  assert.equal((await service.today(employee)).workday,true);
  assert.equal((await service.today(other)).workday,false);
  await assert.rejects(()=>service.checkIn(other,gps),e=>e.code==='NON_WORKDAY');
  await service.checkIn(employee,gps);now=new Date('2026-11-14T17:30:00+07:00');
  assert.equal((await service.checkOut(employee,gps)).attendance.workingMinutes,480);
  now=new Date('2026-11-15T08:30:00+07:00');
  assert.equal((await service.today(employee)).workday,false);
  await assert.rejects(()=>service.checkIn(employee,gps),e=>e.code==='NON_WORKDAY');
  now=new Date('2026-11-16T08:30:00+07:00');
  assert.equal((await service.checkIn(employee,gps)).attendance.attendanceStatus,'LATE'); // assignment expired; 08:00 default
  holidays.set('2026-11-17',{name:'Holiday'});now=new Date('2026-11-17T08:00:00+07:00');
  await assert.rejects(()=>service.checkIn(employee,gps),e=>e.code==='NON_WORKDAY');
  // Scheduled Saturday leave is valid, while the default employee has no workday.
  now=new Date('2026-11-08T10:00:00+07:00');
  const leave=(await service.requestLeave(employee,{fromDate:'2026-11-14',toDate:'2026-11-14',reason:'Test schedule leave'})).data;
  await assert.rejects(()=>service.requestLeave(other,{fromDate:'2026-11-14',toDate:'2026-11-14',reason:'No scheduled work'}),{statusCode:400});
  await client.query("UPDATE leave_requests SET status='APPROVED' WHERE id=$1",[leave.id]);
  await client.query("INSERT INTO leave_request_histories(leave_request_id,from_status,to_status,note,reviewed_by) VALUES($1,'PENDING','APPROVED','Approved',$2)",[leave.id,other.id]);
  await client.query('DELETE FROM attendance WHERE employee_id=$1 AND work_date=$2',[employee.employeeId,'2026-11-14']);
  await service.syncTodayLeaves(); // Nov 8 must not create future rows
  assert.equal(await repo.find(employee.employeeId,'2026-11-14'),null);
  now=new Date('2026-11-14T01:00:00+07:00');await service.syncTodayLeaves();
  data=await repo.find(employee.employeeId,'2026-11-14');
  assert.equal(data.attendanceStatus,'ON_LEAVE');assert.equal(data.checkIn.slice(11,16),'08:30');assert.equal(data.checkOut.slice(11,16),'17:30');
  assert.equal(data.workingMinutes,0);assert.equal(data.overtimeMinutes,0);
  await assert.rejects(()=>service.checkIn(employee,gps),e=>e.code==='NON_WORKDAY');
  const third=await person(3);await client.query("INSERT INTO employee_schedule_assignments(employee_id,schedule_id,effective_from,effective_to) VALUES($1,$2,'2026-11-09','2026-11-14')",[third.employeeId,delayed]);
  assert.equal(await repo.closeAbsent('2026-11-14'),1); // only third: first ON_LEAVE, other off
  assert.equal((await repo.find(third.employeeId,'2026-11-14')).attendanceStatus,'ABSENT');
  assert.equal(await repo.find(other.employeeId,'2026-11-14'),null);
  assert.equal(await repo.closeAbsent('2026-11-15'),0); // Sunday
  await client.query('DELETE FROM attendance WHERE employee_id=$1 AND work_date=$2',[third.employeeId,'2026-11-14']);
  now=new Date('2026-11-15T01:00:00+07:00');
  assert.equal((await service.closePreviousDay()).created,1); // scheduled Saturday still gets auto-closed
  assert.equal((await service.closePreviousDay()).created,0); // idempotent
  await client.query("UPDATE employees SET employment_status='INACTIVE' WHERE id=$1",[third.employeeId]);
  assert.equal(await repo.closeAbsent('2026-11-07'),0);
  await client.query('DELETE FROM employee_schedule_assignments');await client.query('UPDATE work_schedules SET is_default=FALSE');
  assert.equal(await repo.getSchedule(other.employeeId,'2026-11-09'),null);
  await assert.rejects(()=>service.configuration(other),e=>e.code==='SCHEDULE_NOT_CONFIGURED');
  console.log('PASS: assigned/default schedules; exact boundaries; lunch overlap; overtime; weekend leave/absence; no production writes.');
 }finally{if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}client.release(true);await databasePool.end();}
});
