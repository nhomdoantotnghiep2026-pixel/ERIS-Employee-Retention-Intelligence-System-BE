const test=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const {CareerProfileService}=require('../src/modules/career-profile/career-profile.service');
const {CareerProfileRepository}=require('../src/modules/career-profile/career-profile.repository');
const {createCareerProfileRouter}=require('../src/modules/career-profile/career-profile.routes');
const {validateBody,positiveId}=require('../src/modules/career-profile/career-profile.validation');
const {errorHandler}=require('../src/common/middleware/error-handler');
const create={careerAspiration:'Backend Developer',goalDescription:'Learn system design'};
const replacement={newCareerAspiration:'Data Analyst',newGoalDescription:'Learn SQL',goalChangeReason:'New direction'};
function fixture(policy) {
  let rows=[],seq=0,fail=false;
  const actors={1:{role:'EMPLOYEE',status:'ACTIVE',employeeId:11},2:{role:'HR',status:'ACTIVE'},3:{role:'EMPLOYEE',status:'INACTIVE',employeeId:12},4:{role:'EMPLOYEE',status:'ACTIVE',employeeId:12},5:{role:'EMPLOYEE',status:'ACTIVE'}};
  const repo={
    transaction:async fn=>{const before=structuredClone(rows);try{return await fn(repo);}catch(e){rows=before;throw e;}},
    actor:async id=>actors[id],employee:async id=>id===99?null:{id,employeeCode:'EMP'+id,fullName:'Employee',status:'ACTIVE'},lockEmployee:async()=>{},
    goals:async id=>({currentGoal:rows.find(r=>r.employeeId===id&&r.status==='ACTIVE')||null,history:rows.filter(r=>r.employeeId===id&&r.status!=='ACTIVE')}),
    goal:async(id,employeeId)=>rows.find(r=>r.id===id&&r.employeeId===employeeId),
    insert:async(employeeId,data)=>{if(fail)throw new Error('insert failed');const row={id:++seq,employeeId,...data,status:'ACTIVE',goalChangeReason:null,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};rows.push(row);return row;},
    update:async(before,data)=>{const after={...before,...data,updatedAt:new Date().toISOString()};rows=rows.map(r=>r.id===before.id?after:r);return after;},
    alerts:async()=>[11,12].map(employeeId=>({employeeId,replacementCount:rows.filter(r=>r.employeeId===employeeId&&r.status==='REPLACED').length})).filter(r=>r.replacementCount>=3)
  };
  return {service:new CareerProfileService(repo,policy),repo,rows:()=>rows,failInsert:()=>{fail=true;}};
}
test('strict validation rejects spoofing, unsupported fields, nulls, blanks and invalid IDs',()=>{
  assert.deepEqual(validateBody({...create,careerAspiration:' Backend Developer '},'create'),create);
  for(const body of [null,[],{}, {...create,status:'ACTIVE'},{...create,employeeId:12},{...create,careerAspiration:' '},{...create,goalDescription:null},{...create,careerAspiration:'x'.repeat(151)}]) assert.throws(()=>validateBody(body,'create'),{statusCode:400});
  for(const body of [{careerAspiration:'New'},{goalDescription:'x',status:'ACHIEVED'},{goalDescription:''}]) assert.throws(()=>validateBody(body,'edit'),{statusCode:400});
  assert.throws(()=>validateBody({...replacement,goalChangeReason:' '},'replace'),{statusCode:400});
  assert.throws(()=>validateBody({status:'ACHIEVED'},'complete'),{statusCode:400});
  assert.deepEqual(validateBody(undefined,'complete'),{});
  for(const body of [undefined,{}, {goalChangeReason:null},{goalChangeReason:' '}]) assert.deepEqual(validateBody(body,'cancel'),{goalChangeReason:null});
  for(const id of ['0','-1','1.2','2147483648',[],undefined]) assert.throws(()=>positiveId(id),{statusCode:400});
});
test('lifecycle: create conflict, same-ID edit, replace history, cancel, complete and create again',async()=>{
  const f=fixture(),s=f.service;
  assert.deepEqual(await s.own(1),{currentGoal:null,history:[]});
  const first=await s.own(1,'create',undefined,create);
  await assert.rejects(s.own(1,'create',undefined,create),{statusCode:409});
  await s.own(1,'edit',first.id,{goalDescription:'Updated'});
  assert.equal(f.rows().length,1);assert.equal(f.rows()[0].careerAspiration,create.careerAspiration);
  const result=await s.own(1,'replace',first.id,replacement);
  assert.equal(result.previousGoal.status,'REPLACED');assert.equal(result.previousGoal.goalChangeReason,replacement.goalChangeReason);
  assert.equal(result.currentGoal.status,'ACTIVE');assert.equal(result.currentGoal.goalChangeReason,null);assert.equal(f.rows().length,2);
  await s.own(1,'cancel',result.currentGoal.id,{goalChangeReason:null});
  assert.equal((await s.own(1)).currentGoal,null);
  const third=await s.own(1,'create',undefined,create);
  assert.equal(f.rows().length,3);assert.equal((await s.own(1,'complete',third.id)).status,'ACHIEVED');
  for(const row of f.rows()) for(const action of ['edit','complete','replace','cancel']) await assert.rejects(s.own(1,action,row.id,replacement),{statusCode:409});
  await s.own(1,'create',undefined,create);
});
test('authorization: roles, account status, linked employee, ownership and HR policy',async()=>{
  const {service:s}=fixture(async(_actor,id)=>id===11);
  for(const actor of [2,3,5]) await assert.rejects(s.own(actor),{statusCode:403});
  const goal=await s.own(1,'create',undefined,create);
  await assert.rejects(s.own(4,'edit',goal.id,{goalDescription:'Other'}),{statusCode:404});
  await assert.rejects(s.getEmployee(1,11),{statusCode:403});
  await assert.rejects(s.getEmployee(2,12),{statusCode:404});
  assert.equal((await s.getEmployee(2,11)).currentGoal.id,goal.id);
  await assert.rejects(s.own(2,'replace',goal.id,replacement),{statusCode:403});
});
test('replace insert failure rolls back previous goal',async()=>{
  const f=fixture();const goal=await f.service.own(1,'create',undefined,create);f.failInsert();
  await assert.rejects(f.service.own(1,'replace',goal.id,replacement),/insert failed/);
  assert.equal(f.rows().length,1);assert.equal(f.rows()[0].status,'ACTIVE');
});
test('description edits do not count; replacement alerts respect HR scope',async()=>{
  const f=fixture(async(_actor,id)=>id===11),s=f.service;
  const goal=await s.own(1,'create',undefined,create);
  for(let n=0;n<3;n++) await s.own(1,'edit',goal.id,{goalDescription:'Edit '+n});
  assert.deepEqual(await s.alerts(2),{items:[]});
  for(const actor of [1,4]) {
    let current=actor===1?goal:await s.own(actor,'create',undefined,create);
    for(let n=0;n<3;n++) current=(await s.own(actor,'replace',current.id,replacement)).currentGoal;
  }
  const {items}=await s.alerts(2);assert.equal(items.length,1);assert.equal(items[0].employeeId,11);assert.equal(items[0].replacementCount,3);
});
test('repository: existing table, owned row lock, audit, rollback and release',async()=>{
  const calls=[];const row={id:7,employeeId:11,...create,status:'ACTIVE'};
  const client={query:async(sql,args)=>{calls.push({sql,args});return {rows:sql.includes('RETURNING')?[row]:[]};},release:()=>calls.push({sql:'release'})};
  const repo=new CareerProfileRepository({connect:async()=>client});
  await assert.rejects(repo.transaction(async r=>{await r.lockEmployee(11);await r.goal(7,11);await r.insert(11,create,1);throw new Error('fail');}),/fail/);
  assert.equal(calls[0].sql,'BEGIN');assert.equal(calls.at(-2).sql,'ROLLBACK');assert.equal(calls.at(-1).sql,'release');
  const lock=calls.find(c=>c.sql.includes('FOR UPDATE'));assert.deepEqual(lock.args,[7,11]);assert.ok(lock.sql.includes('employee_id=$2'));
  const insert=calls.find(c=>c.sql.startsWith('INSERT INTO employee_career_profiles'));assert.deepEqual(insert.args,[11,create.careerAspiration,create.goalDescription]);assert.doesNotMatch(insert.sql,/ON CONFLICT|career_interests|goal_title|target_date/);
  const audit=calls.find(c=>c.sql.startsWith('INSERT INTO audit_logs'));assert.equal(audit.args[1],'employee_career_profiles');assert.equal(audit.args[2],7);
});
test('only expected ACTIVE unique-index violation maps to 409',async()=>{
  const f=fixture();
  f.repo.transaction=async()=>{throw Object.assign(new Error('unique'),{code:'23505',constraint:'uq_employee_active_career_profile'});};
  await assert.rejects(f.service.own(1),{statusCode:409});
  f.repo.transaction=async()=>{throw Object.assign(new Error('unique'),{code:'23505',constraint:'other'});};
  await assert.rejects(f.service.own(1),e=>e.code==='23505'&&!e.statusCode);
});
test('HTTP: eight endpoints, validation, auth, no-store and unrelated routes',async()=>{
  const app=express();app.use(express.json());
  app.use('/api',createCareerProfileRouter({service:fixture().service,authenticate:(req,res,next)=>{if(!req.get('x-user'))return res.status(401).json({message:'Token required'});req.auth={userId:Number(req.get('x-user'))};next();}}));
  app.get('/api/unrelated',(_req,res)=>res.sendStatus(204));app.use(errorHandler);
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const request=(path,user=1,method='GET',body)=>fetch('http://127.0.0.1:'+server.address().port+'/api'+path,{method,headers:{...(user?{'x-user':String(user)}:{}),'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  try {
    assert.equal((await request('/unrelated',null)).status,204);
    assert.equal((await request('/me/career-goals',null)).status,401);
    const empty=await request('/me/career-goals');assert.equal(empty.status,200);assert.match(empty.headers.get('cache-control'),/no-store/);
    assert.deepEqual(await empty.json(),{currentGoal:null,history:[]});
    const saved=await request('/me/career-goals',1,'POST',create);assert.equal(saved.status,201);const goal=await saved.json();
    assert.equal((await request('/me/career-goals',1,'POST',create)).status,409);
    assert.equal((await request('/me/career-goals/'+goal.id,1,'PATCH',{goalDescription:'Updated'})).status,200);
    assert.equal((await request('/me/career-goals/'+goal.id,4,'PATCH',{goalDescription:'Other'})).status,404);
    assert.equal((await request('/me/career-goals/'+goal.id+'/replace',2,'POST',replacement)).status,403);
    const replaced=await request('/me/career-goals/'+goal.id+'/replace',1,'POST',replacement);assert.equal(replaced.status,200);const next=(await replaced.json()).currentGoal;
    assert.equal((await request('/me/career-goals/'+next.id+'/complete',1,'POST')).status,200);
    assert.equal((await request('/me/career-goals/'+next.id+'/cancel',1,'POST')).status,409);
    const another=await (await request('/me/career-goals',1,'POST',create)).json();
    assert.equal((await request('/me/career-goals/'+another.id+'/cancel',1,'POST')).status,200);
    assert.equal((await request('/employees/11/career-goals',2)).status,200);
    assert.equal((await request('/employees/99/career-goals',2)).status,404);
    assert.equal((await request('/hr/career-goals/alerts',2)).status,200);
    assert.equal((await request('/hr/career-goals/alerts',1)).status,403);
    assert.equal((await request('/me/career-goals?status=ACTIVE')).status,400);
    assert.equal((await request('/me/career-goals/abc',1,'PATCH',{goalDescription:'x'})).status,400);
  }finally{await new Promise(r=>server.close(r));}
});
