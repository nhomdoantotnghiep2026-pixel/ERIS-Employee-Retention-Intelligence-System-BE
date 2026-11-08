const test=require('node:test');const assert=require('node:assert/strict');const express=require('express');
const {databasePool}=require('../src/config/database');
const {WorkSchedulesRepository}=require('../src/modules/work-schedules/work-schedules.repository');
const {WorkSchedulesService}=require('../src/modules/work-schedules/work-schedules.service');
const {createScheduleAssignmentsRouter}=require('../src/modules/work-schedules/work-schedules.routes');
test('TEMP + HTTP: delete unused assignment, forbid history, ownership, permissions and audit rollback',async()=>{
 const client=await databasePool.connect();let server,failAudit=false;
 const query=(sql,args)=>{if(failAudit&&sql.startsWith('INSERT INTO audit_logs'))throw new Error('Simulated audit failure');return client.query(sql,args);};
 const pool={query,connect:async()=>({query,release(){}})};
 try{
  await client.query("SET statement_timeout TO '10s'");
  for(const name of ['role','employees','users','work_schedules','employee_schedule_assignments','attendance','audit_logs'])await client.query(`CREATE TEMP TABLE ${name} (LIKE public.${name} INCLUDING ALL)`);
  await client.query('SET search_path TO pg_temp');
  const {rows:[dates]}=await client.query("SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Ho_Chi_Minh')::date::text AS today, ((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Ho_Chi_Minh')::date-1)::text AS yesterday,((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Ho_Chi_Minh')::date+1)::text AS tomorrow");
  const roles=(await client.query("INSERT INTO role(name) VALUES('HR'),('EMPLOYEE') RETURNING id,name")).rows;
  const person=async n=>(await client.query("INSERT INTO employees(employee_code,full_name,hire_date,employment_status) VALUES($1,$2,'2020-01-01','ACTIVE') RETURNING id",['DELETE'+n,'Delete test '+n])).rows[0].id;
  const employee=await person(1),other=await person(2);
  const users=[];for(const role of roles)users.push((await client.query("INSERT INTO users(email,password,role_id,status) VALUES($1,'hash',$2,'ACTIVE') RETURNING id",[role.name.toLowerCase()+'@delete.invalid',role.id])).rows[0].id);
  const [hr,employeeUser]=users;
  const schedule=(await client.query("INSERT INTO work_schedules(name,start_time,end_time,break_start,break_end,working_days,status,is_default) VALUES('Delete test','08:00','17:00','12:00','13:00',ARRAY[1,2,3,4,5],'ACTIVE',FALSE) RETURNING id")).rows[0].id;
  const repo=new WorkSchedulesRepository(pool),service=new WorkSchedulesService(repo);
  const assign=(id,from,to)=>repo.assign(id,{schedule_id:schedule,effective_from:from,effective_to:to},hr);
  const exists=async id=>(await client.query('SELECT id FROM employee_schedule_assignments WHERE id=$1',[id])).rows.length===1;
  const app=express();app.use(express.json());app.use('/api/employees',createScheduleAssignmentsRouter({service,authenticate:(req,res,next)=>{if(!req.headers['x-test-user'])return res.status(401).json({message:'Missing token'});req.auth={userId:Number(req.headers['x-test-user'])};next();}}));
  app.use((e,req,res,next)=>res.status(e.statusCode||500).json({message:e.message}));
  await new Promise(resolve=>{server=app.listen(0,'127.0.0.1',resolve);});
  const call=async(id,assignmentId,user=hr,body)=>{const response=await fetch(`http://127.0.0.1:${server.address().port}/api/employees/${id}/schedule-assignments/${assignmentId}`,{method:'DELETE',headers:{...(user?{'x-test-user':String(user)}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,body:await response.json()};};
  const future=await assign(employee,dates.tomorrow,null);
  assert.equal((await call(employee,future.id,null)).status,401);
  assert.equal((await call(employee,future.id,employeeUser)).status,403);
  assert.equal((await call(employee,'0')).status,400);
  assert.equal((await call(employee,future.id,hr,{employeeId:other})).status,400);
  assert.equal((await call(other,future.id)).status,404);assert.equal(await exists(future.id),true);
  failAudit=true;assert.equal((await call(employee,future.id)).status,500);assert.equal(await exists(future.id),true);failAudit=false;
  const removed=await call(employee,future.id);assert.equal(removed.status,200);assert.equal(removed.body.data.id,future.id);assert.equal(await exists(future.id),false);
  const audit=(await client.query("SELECT action,old_value,new_value FROM audit_logs WHERE entity_type='employee_schedule_assignments' AND entity_id=$1 ORDER BY id DESC LIMIT 1",[future.id])).rows[0];
  assert.equal(audit.action,'DELETE');assert.equal(audit.old_value.employee_id,employee);assert.equal(audit.new_value,null);
  assert.equal((await call(employee,future.id)).status,404);
  const replacement=await assign(employee,dates.tomorrow,null);assert.equal(await exists(replacement.id),true);
  const today=await assign(other,dates.today,dates.today);
  assert.equal((await call(other,today.id)).status,200); // today's unused mistake can be corrected
  const past=await assign(other,dates.yesterday,dates.yesterday);
  assert.equal((await call(other,past.id)).status,409);assert.equal(await exists(past.id),true);
  const used=await assign(other,dates.today,dates.today);
  await client.query("INSERT INTO attendance(employee_id,work_date,check_in,attendance_status,working_minutes,overtime_minutes) VALUES($1,$2::date,$2::date+TIME '08:00','PRESENT',0,0)",[other,dates.today]);
  assert.equal((await call(other,used.id)).status,409);assert.equal(await exists(used.id),true);
  const unrelated=await assign(other,dates.tomorrow,null);
  assert.equal((await call(other,unrelated.id)).status,200); // attendance outside assigned dates does not block
  assert.equal((await client.query('SELECT COUNT(*)::int AS n FROM work_schedules')).rows[0].n,1);
  assert.equal((await client.query('SELECT COUNT(*)::int AS n FROM attendance')).rows[0].n,1);
  await client.query("UPDATE users SET status='INACTIVE' WHERE id=$1",[hr]);
  assert.equal((await call(employee,replacement.id)).status,403);
  console.log('PASS: delete then reassign; protects past/used dates; audit is atomic; no production writes.');
 }finally{if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}client.release(true);await databasePool.end();}
});
