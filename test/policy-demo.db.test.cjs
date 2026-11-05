const test=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const {databasePool}=require('../src/config/database');
const {authenticate}=require('../src/common/middleware/authenticate');
const {createAccessToken}=require('../src/common/utils/token');
const {errorHandler}=require('../src/common/middleware/error-handler');
const {PolicyDemoRepository}=require('../src/modules/prediction_results/policy-demo.repository');
const {createPolicyDemoRouter}=require('../src/modules/prediction_results/policy-demo.routes');

test('Policy demo: HTTP/JWT + PostgreSQL TEMP, liên kết đủ 4 bảng, quyền HR và rollback',async()=>{
  const client=await databasePool.connect();
  let server,failWrite=false;
  const pool={query:(...args)=>client.query(...args),connect:async()=>({release(){},query(sql,values){
    if(failWrite && sql.startsWith('INSERT INTO policy_recommendations')) throw new Error('Simulated demo write failure');
    return client.query(sql,values);
  }})};
  try {
    await client.query("SET statement_timeout TO '10s'");
    for(const table of ['role','employees','users','model_run','ai_input','prediction_results','explainable','retention_policies','policy_recommendations']) {
      await client.query(`CREATE TEMP TABLE ${table} (LIKE public.${table} INCLUDING ALL)`);
    }
    await client.query(`SET search_path TO pg_temp,public;
      ALTER TABLE model_run ADD FOREIGN KEY(created_by) REFERENCES users(id);
      ALTER TABLE ai_input ADD FOREIGN KEY(employee_id) REFERENCES employees(id);
      ALTER TABLE prediction_results ADD FOREIGN KEY(prediction_run_id) REFERENCES model_run(id),
        ADD FOREIGN KEY(snapshot_id,employee_id) REFERENCES ai_input(id,employee_id) DEFERRABLE INITIALLY DEFERRED;
      ALTER TABLE explainable ADD FOREIGN KEY(prediction_result_id) REFERENCES prediction_results(id);
      ALTER TABLE policy_recommendations ADD FOREIGN KEY(prediction_result_id) REFERENCES prediction_results(id),
        ADD FOREIGN KEY(policy_id) REFERENCES retention_policies(id);
      INSERT INTO role(name) VALUES('HR'),('EMPLOYEE'),('ADMIN');`);
    const actors={};
    for(const role of ['HR','EMPLOYEE','ADMIN']) {
      actors[role]=(await client.query(`INSERT INTO users(email,password,role_id,status)
        SELECT $1,'hash',id,'ACTIVE' FROM role WHERE name=$2 RETURNING id,role_id AS "roleId",status`,[role.toLowerCase()+'@policy.invalid',role])).rows[0];
    }
    const employeeIds=[];
    for(let i=0;i<2;i++) {
      const employee=(await client.query(`INSERT INTO employees(employee_code,full_name,hire_date,employment_status)
        VALUES($1,$2,'2020-01-01','ACTIVE') RETURNING id`,[`DEMO${i}`,`Demo Employee ${i}`])).rows[0];
      await client.query(`INSERT INTO users(email,password,role_id,status,employee_id)
        SELECT $1,'hash',id,'ACTIVE',$2 FROM role WHERE name='EMPLOYEE'`,[`staff${i}@policy.invalid`,employee.id]);
      employeeIds.push(employee.id);
    }
    const repository=new PolicyDemoRepository(pool);
    const app=express();app.use(express.json());
    app.use('/api',createPolicyDemoRouter({repository,authenticate}));app.use(errorHandler);
    await new Promise((resolve,reject)=>{server=app.listen(0,'127.0.0.1',resolve);server.on('error',reject);});
    const base=`http://127.0.0.1:${server.address().port}/api`;
    const call=async(method,url,body,role='HR')=>{
      const res=await fetch(base+url,{method,headers:{'Content-Type':'application/json',...(role?{Authorization:`Bearer ${createAccessToken(actors[role])}`}:{})},
        body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(5000)});
      return {status:res.status,body:await res.json()};
    };
    const counts=async()=> (await client.query(`SELECT
      (SELECT count(*)::int FROM model_run) AS runs,(SELECT count(*)::int FROM ai_input) AS inputs,
      (SELECT count(*)::int FROM prediction_results) AS predictions,(SELECT count(*)::int FROM explainable) AS explanations,
      (SELECT count(*)::int FROM retention_policies) AS policies,(SELECT count(*)::int FROM policy_recommendations) AS recommendations`)).rows[0];

    assert.deepEqual((await call('GET','/retention-policies')).body,{data:[]});
    assert.equal((await call('GET','/retention-policies',undefined,null)).status,401);
    for(const role of ['EMPLOYEE','ADMIN']) {
      assert.equal((await call('GET','/policy-recommendations',undefined,role)).status,403);
      assert.equal((await call('POST','/prediction-results/demo',{employeeIds},role)).status,403);
    }
    for(const body of [{},{employeeIds:[]},{employeeIds:[employeeIds[0],employeeIds[0]]},{employeeIds:['1']},
      {employeeIds,probability:0.99},{employeeIds:[2147483648]}]) {
      assert.equal((await call('POST','/prediction-results/demo',body)).status,400);
    }
    assert.equal((await call('POST','/prediction-results/demo',{employeeIds:[employeeIds[0],2147483647]})).status,409);
    assert.deepEqual(await counts(),{runs:0,inputs:0,predictions:0,explanations:0,policies:0,recommendations:0});
    const created=await call('POST','/prediction-results/demo',{employeeIds});
    assert.equal(created.status,201);
    assert.equal(created.body.dataSource,'DEMO_FIXED');
    assert.equal(created.body.modelInvoked,false);
    assert.equal(created.body.run.modelVersion,'DEMO_FIXED_POLICY_V1');
    assert.equal(created.body.results.length,2);
    assert.deepEqual(await counts(),{runs:1,inputs:2,predictions:2,explanations:4,policies:2,recommendations:4});
    for(const result of created.body.results) {
      assert.equal(result.attritionProbability,0.78);
      assert.equal(result.riskLevel,'HIGH');
      assert.equal(result.explanations.length,2);
      assert.equal(result.recommendations.length,2);
      assert.equal(result.input.overtime_hours,24);
      assert.equal(result.input.employee_satisfaction_score,2);
      assert(result.recommendations.every(item=>item.status==='SUGGESTED' && item.employee.id===result.employee.id));
    }
    const result=created.body.results[0],recommendation=result.recommendations[0];
    assert.equal((await call('GET',`/prediction-results/${result.id}`)).body.data.snapshotId,result.snapshotId);
    assert.equal((await call('GET',`/policy-recommendations/${recommendation.id}`)).body.data.policy.name,recommendation.policy.name);
    assert.equal((await call('GET',`/retention-policies/${recommendation.policyId}`)).body.data.id,recommendation.policyId);
    assert.equal((await call('GET','/policy-recommendations')).body.data.length,4);
    for(const url of ['/prediction-results/not-an-id','/retention-policies/0','/policy-recommendations/9223372036854775808']) {
      assert.equal((await call('GET',url)).status,400);
    }
    assert.equal((await call('GET','/prediction-results/2147483647')).status,404);
    assert.equal((await call('POST','/prediction-results/demo',{employeeIds:[employeeIds[0]]})).status,201);
    assert.equal((await counts()).policies,2);
    const before=await counts();
    failWrite=true;
    await assert.rejects(()=>repository.createDemo(actors.HR.id,[employeeIds[0]]),/Simulated demo write failure/);
    failWrite=false;
    assert.deepEqual(await counts(),before);
    await client.query("UPDATE users SET status='INACTIVE' WHERE id=$1",[actors.HR.id]);
    assert.equal((await call('GET','/retention-policies')).status,403);
    assert.equal((await call('POST','/prediction-results/demo',{employeeIds})).status,403);
    console.log('PASS: dữ liệu cố định không gọi model; 4 bảng + model_run/ai_input liên kết hợp lệ; GET trả policy và nhân viên; HR/JWT/validation; dùng lại catalog; rollback cả bộ.');
  } finally {
    if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
    await client.query('RESET search_path');
    await client.query(`DROP TABLE IF EXISTS pg_temp.policy_recommendations,pg_temp.explainable,pg_temp.prediction_results,
      pg_temp.ai_input,pg_temp.model_run,pg_temp.retention_policies,pg_temp.users,pg_temp.employees,pg_temp.role`);
    client.release();await databasePool.end();
  }
});
