const test=require('node:test');const assert=require('node:assert/strict');const express=require('express');
const {databasePool}=require('../src/config/database');const {AppError}=require('../src/common/errors/app-error');
const {WorkSchedulesRepository}=require('../src/modules/work-schedules/work-schedules.repository');
const {WorkSchedulesService}=require('../src/modules/work-schedules/work-schedules.service');
const {createWorkSchedulesRouter}=require('../src/modules/work-schedules/work-schedules.routes');
const {AttendanceRepository}=require('../src/modules/attendance/attendance.repository');
const {resolveSchedule}=require('../src/modules/attendance/attendance-schedule');
class Store{
 constructor(){this.value=null;this.fail=false;this.failCommit=false;}
 async get(){return structuredClone(this.value);}
 async put(value){if(this.fail)throw new AppError(503,'Redis test offline');if(this.value)throw new AppError(409,'Pending');this.value=structuredClone(value);}
 async clear(id){if(this.value?.requestId===id)this.value=null;}
}
const input=name=>({name,start_time:'09:00',end_time:'18:00',break_start:'12:00',break_end:'13:00',working_days:[1,2,3,4,5,6,7]});
test('TEMP + HTTP: future defaults persist per employee, preserve private schedules and survive Redis restart',async()=>{
 const client=await databasePool.connect();const store=new Store();let server,now=new Date('2026-11-08T10:00:00+07:00');
 const query=(sql,args)=>{if(sql==='COMMIT'&&store.failCommit&&store.value)throw new Error('Simulated commit failure');return client.query(sql.replaceAll('public.attendance','attendance'),args);};
 const pool={query,connect:async()=>({query,release(){}})};
 try{
  await client.query("SET statement_timeout TO '10s'");
  for(const name of ['role','employees','users','work_schedules','employee_schedule_assignments','attendance','audit_logs'])await client.query(`CREATE TEMP TABLE ${name} (LIKE public.${name} INCLUDING ALL)`);
  await client.query(`SET search_path TO pg_temp,public;
   ALTER TABLE employee_schedule_assignments ADD EXCLUDE USING gist (employee_id WITH =,daterange(effective_from,effective_to,'[]') WITH &&);`);
  const roles=(await client.query("INSERT INTO role(name) VALUES('HR'),('EMPLOYEE') RETURNING id,name")).rows;
  const account=async(email,role,employeeId=null)=>(await client.query("INSERT INTO users(email,password,role_id,status,employee_id) VALUES($1,'hash',$2,'ACTIVE',$3) RETURNING id",[email,roles.find(r=>r.name===role).id,employeeId])).rows[0].id;
  const hr=await account('hr@default.invalid','HR');
  const person=async(code,status='ACTIVE')=>(await client.query("INSERT INTO employees(employee_code,full_name,hire_date,employment_status) VALUES($1,$1,'2020-01-01',$2) RETURNING id",[code,status])).rows[0].id;
  const a=await person('DEFAULT_A'),b=await person('PRIVATE_B'),c=await person('NO_SCHEDULE_C'),inactive=await person('INACTIVE_D','INACTIVE'),forever=await person('PRIVATE_FOREVER');
  const employeeAccount=await account('employee@default.invalid','EMPLOYEE',a);
  const old=(await client.query("INSERT INTO work_schedules(name,start_time,end_time,break_start,break_end,working_days,status,is_default) VALUES('Old','08:00','17:00','12:00','13:00',ARRAY[1,2,3,4,5,6,7],'ACTIVE',TRUE) RETURNING id")).rows[0].id;
  const privateId=(await client.query("INSERT INTO work_schedules(name,start_time,end_time,break_start,break_end,working_days,status) VALUES('Private existing','08:30','17:30','12:00','13:00',ARRAY[1,2,3,4,5,6,7],'ACTIVE') RETURNING id")).rows[0].id;
  await client.query("INSERT INTO employee_schedule_assignments(employee_id,schedule_id,effective_from,effective_to) VALUES($1,$2,'2026-11-01',NULL),($3,$4,'2026-11-01','2026-11-11'),($5,$4,'2026-11-01',NULL)",[a,old,b,privateId,forever]);
  await client.query("INSERT INTO employee_schedule_assignments(employee_id,schedule_id,effective_from,effective_to) VALUES($1,$2,'2026-11-01',NULL)",[inactive,old]);
  const repo=new WorkSchedulesRepository(pool,{defaultStore:store,clock:()=>now});const service=new WorkSchedulesService(repo);
  await repo.syncDefaults();
  const history=async employeeId=>(await repo.findAssignments(employeeId)).map(r=>({id:r.id,schedule:r.schedule_id,from:r.effective_from,to:r.effective_to})).sort((x,y)=>x.from.localeCompare(y.from));
  const app=express();app.use(express.json());app.use('/api/work-schedules',createWorkSchedulesRouter({service,authenticate:(req,res,next)=>{if(!req.headers['x-test-user'])return res.status(401).json({message:'No token'});req.auth={userId:Number(req.headers['x-test-user'])};next();}}));app.use((e,req,res,next)=>res.status(e.statusCode||500).json({message:e.message}));
  await new Promise(r=>{server=app.listen(0,'127.0.0.1',r)});
  const call=async(path,body,user=hr)=>{const response=await fetch(`http://127.0.0.1:${server.address().port}/api/work-schedules${path}`,{method:'POST',headers:{...(user?{'x-test-user':String(user)}:{}),'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(30000)});return {status:response.status,body:await response.json()};};
  assert.equal((await call('/default',input('No auth'),null)).status,401);
  assert.equal((await call('/default',input('Wrong role'),employeeAccount)).status,403);
  assert.equal((await call('/default',{...input('Wrong date'),effective_from:'2026-11-08'})).status,400);
  assert.equal((await call('/default',{...input('Inactive'),status:'INACTIVE'})).status,400);
  const planned=await call('/default',input('Default tomorrow'));assert.equal(planned.status,201,JSON.stringify(planned));
  const first=planned.body.data.id;assert.equal(planned.body.data.effective_from,'2026-11-09');assert.equal(planned.body.data.effective_to,null);
  assert.equal((await client.query('SELECT id FROM work_schedules WHERE is_default=TRUE')).rows[0].id,old);
  assert.equal((await resolveSchedule(pool,a,'2026-11-08')).id,old);
  assert.equal((await resolveSchedule(pool,a,'2026-11-09')).id,first);
  assert.equal((await resolveSchedule(pool,b,'2026-11-09')).id,privateId);
  assert.equal((await resolveSchedule(pool,b,'2026-11-12')).id,first);
  assert.equal((await history(a))[0].to,'2026-11-08');
  assert.equal((await history(c)).some(r=>r.schedule===first&&r.from==='2026-11-09'&&r.to===null),true);
  assert.equal((await history(b)).some(r=>r.schedule===privateId&&r.from==='2026-11-01'&&r.to==='2026-11-11'),true);
  assert.equal((await history(inactive)).length,1);assert.equal((await history(inactive))[0].to,'2026-11-08');assert.equal((await history(inactive)).some(r=>r.schedule===first),false);assert.equal((await history(forever)).length,1);
  const count=(await client.query('SELECT count(*)::int AS n FROM work_schedules')).rows[0].n;
  assert.equal((await call('/default',input('Second pending'))).status,409);
  assert.equal((await client.query('SELECT count(*)::int AS n FROM work_schedules')).rows[0].n,count);
  assert.equal((await repo.syncDefaults()).activated,false);
  now=new Date('2026-11-09T00:01:00+07:00');assert.equal((await repo.syncDefaults()).activated,true);
  assert.equal((await client.query('SELECT id FROM work_schedules WHERE is_default=TRUE')).rows[0].id,first);assert.equal(store.value,null);
  const e=await person('NEW_ACTIVE');await repo.syncDefaults(e);
  assert.equal((await history(e))[0].schedule,first);assert.equal((await history(e))[0].from,'2026-11-09');
  // Creating a private schedule splits default rows and restores the default after its end.
  assert.equal((await call('/individual',{...input('No end'),employee_id:a,effective_from:'2026-11-10'})).status,400);
  const personal=await call('/individual',{...input('Private new'),start_time:'08:30',end_time:'17:30',employee_id:a,effective_from:'2026-11-10',effective_to:'2026-11-11'});
  assert.equal(personal.status,201,JSON.stringify(personal));const personalId=personal.body.data.id;
  assert.equal((await resolveSchedule(pool,a,'2026-11-09')).id,first);
  assert.equal((await resolveSchedule(pool,a,'2026-11-10')).id,personalId);
  assert.equal((await resolveSchedule(pool,a,'2026-11-12')).id,first);
  assert.equal((await call('/individual',{...input('Private overlap'),employee_id:a,effective_from:'2026-11-11',effective_to:'2026-11-12'})).status,409);
  // A second default must also replace future default resumption, without touching the private interval.
  const secondPlan=await call('/default',input('Second default'));assert.equal(secondPlan.status,201,JSON.stringify(secondPlan));const second=secondPlan.body.data.id;
  assert.equal(secondPlan.body.data.effective_from,'2026-11-10');
  assert.equal((await resolveSchedule(pool,a,'2026-11-10')).id,personalId);
  assert.equal((await resolveSchedule(pool,a,'2026-11-12')).id,second);
  store.value=null;assert.equal((await repo.pendingDefault()).scheduleId,second); // restore from committed audit
  now=new Date('2026-11-10T00:01:00+07:00');assert.equal((await repo.syncDefaults()).activated,true);
  const attendance=new AttendanceRepository(pool);
  await attendance.record({userId:employeeAccount,employeeId:a,date:'2026-11-10',instant:'2026-11-10T08:30:00+07:00',action:'check-in'});
  const checkedOut=await attendance.record({userId:employeeAccount,employeeId:a,date:'2026-11-10',instant:'2026-11-10T17:30:00+07:00',action:'check-out'});
  assert.equal(checkedOut.attendanceStatus,'PRESENT');assert.equal(checkedOut.workingMinutes,480);assert.equal(checkedOut.overtimeMinutes,0);
  assert.equal((await call('/individual',{...input('Used day'),employee_id:a,effective_from:'2026-11-10',effective_to:'2026-11-10'})).status,409);
  // Failed Redis/commit writes must not leave an orphan schedule or a partially closed history.
  const beforeSchedules=(await client.query('SELECT count(*)::int AS n FROM work_schedules')).rows[0].n;
  const beforeHistory=await history(c);store.fail=true;
  assert.equal((await call('/default',input('Redis failure'))).status,503);store.fail=false;
  assert.equal((await client.query('SELECT count(*)::int AS n FROM work_schedules')).rows[0].n,beforeSchedules);assert.deepEqual(await history(c),beforeHistory);
  store.failCommit=true;assert.equal((await call('/default',input('Commit failure'))).status,500);store.failCommit=false;
  assert.equal(store.value,null);assert.deepEqual(await history(c),beforeHistory);
  assert.equal((await client.query('SELECT count(*)::int AS n FROM work_schedules')).rows[0].n,beforeSchedules);
  now=new Date('2026-11-12T08:00:00+07:00');await repo.syncDefaults();assert.equal((await resolveSchedule(pool,a,'2026-11-12')).id,second);
  // Even when every ACTIVE employee has an indefinite private schedule, activation must still work.
  await client.query("UPDATE employees SET employment_status='INACTIVE' WHERE id<>$1",[forever]);
  const empty=await call('/default',input('All private'));assert.equal(empty.status,201);assert.equal(empty.body.data.affectedEmployees,0);assert.equal(empty.body.data.skippedEmployees,1);
  now=new Date('2026-11-13T00:01:00+07:00');assert.equal((await repo.syncDefaults()).activated,true);
  assert.equal((await resolveSchedule(pool,forever,'2026-11-13')).id,privateId);
  console.log('PASS: default/individual HTTP APIs; future activation; old end=new start-1; ACTIVE only; private ranges retained; resumption updated; Redis recovery; rollback; real attendance calculations. TEMP only.');
 }finally{if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}client.release(true);await databasePool.end();}
});
