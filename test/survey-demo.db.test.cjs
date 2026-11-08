const test=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const {databasePool}=require('../src/config/database');
const {SurveysRepository}=require('../src/modules/surveys/surveys.repository');
const {SurveysService}=require('../src/modules/surveys/surveys.service');
const {SurveysController}=require('../src/modules/surveys/surveys.controller');
const {createSurveysRouter}=require('../src/modules/surveys/surveys.routes');

test('Survey demo: all 12 API operations against current schema, shared questions and triggers in TEMP',async()=>{
  const client=await databasePool.connect();let server;
  try{
    await client.query("SET statement_timeout TO '10s'");
    const functions=(await client.query("SELECT DISTINCT pg_get_functiondef(p.oid) AS definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_proc p ON p.oid=t.tgfoid WHERE NOT t.tgisinternal AND n.nspname='public' AND c.relname IN ('survey_responses','survey_answers')")).rows;
    const triggers=(await client.query("SELECT pg_get_triggerdef(t.oid) AS definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE NOT t.tgisinternal AND n.nspname='public' AND c.relname IN ('survey_responses','survey_answers')")).rows;
    const questions=(await client.query('SELECT id,question_text,display_order FROM public.survey_questions ORDER BY display_order,id')).rows;
    assert(questions.length>0,'Shared questions must exist');
    for(const table of ['role','users','employees','audit_logs','surveys','survey_questions','survey_responses','survey_answers'])await client.query(`CREATE TEMP TABLE ${table} (LIKE public.${table} INCLUDING ALL)`);
    await client.query(`SET search_path TO pg_temp;
      ALTER TABLE survey_answers ADD FOREIGN KEY(response_id) REFERENCES survey_responses(id),
        ADD FOREIGN KEY(question_id) REFERENCES survey_questions(id);
      INSERT INTO role(name) VALUES('HR'),('EMPLOYEE');`);
    for(const fn of functions)await client.query(fn.definition.replace(/FUNCTION public\./,'FUNCTION pg_temp.'));
    for(const trigger of triggers)await client.query(trigger.definition.replace(/ON (?:public\.)?/,'ON pg_temp.').replace(/EXECUTE FUNCTION (?:public\.)?(\w+)\(/,'EXECUTE FUNCTION pg_temp.$1('));
    for(const question of questions)await client.query('INSERT INTO survey_questions(id,question_text,display_order) VALUES($1,$2,$3)',[question.id,question.question_text,question.display_order]);
    const hr=(await client.query(`INSERT INTO users(email,password,role_id,status,full_name)
      SELECT 'hr@survey-demo.invalid','hash',id,'ACTIVE','HR demo' FROM role WHERE name='HR' RETURNING id`)).rows[0];
    const employee=(await client.query(`INSERT INTO employees(employee_code,full_name,hire_date,employment_status)
      VALUES('TEST-SURVEY','Employee demo',CURRENT_DATE-INTERVAL '1 year','ACTIVE') RETURNING id`)).rows[0];
    const account=(await client.query(`INSERT INTO users(email,password,role_id,status,employee_id)
      SELECT 'employee@survey-demo.invalid','hash',id,'ACTIVE',$1 FROM role WHERE name='EMPLOYEE' RETURNING id`,[employee.id])).rows[0];
    const repository=new SurveysRepository({query:(...args)=>client.query(...args),connect:async()=>({query:(...args)=>client.query(...args),release(){}})});
    const app=express();app.use(express.json());
    app.use('/api/surveys',createSurveysRouter({surveysController:new SurveysController(new SurveysService({surveysRepository:repository})),authenticate:(req,res,next)=>{req.auth={userId:Number(req.headers['x-test-user'])};next();}}));
    app.use((error,req,res,next)=>res.status(error.statusCode||500).json({message:error.message}));
    await new Promise((resolve,reject)=>{server=app.listen(0,'127.0.0.1',resolve);server.on('error',reject);});
    const url=`http://127.0.0.1:${server.address().port}/api/surveys`;
    const call=async(method,suffix,body,user=hr)=>{const response=await fetch(url+suffix,{method,headers:{'Content-Type':'application/json','x-test-user':String(user.id)},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(5000)});return {status:response.status,body:await response.json()};};
    const metadata={title:'Survey screen test',startDate:new Date(Date.now()-60000).toISOString(),endDate:new Date(Date.now()+86400000).toISOString()};
    const created=await call('POST','',metadata);assert.equal(created.status,201);
    const id=created.body.data.id;assert.equal(created.body.data.questions.length,questions.length);
    assert.equal((await call('PATCH','/'+id,{description:'Updated demo metadata'})).body.data.description,'Updated demo metadata');
    assert.equal((await call('GET','')).body.data.length,1);
    assert.equal((await call('GET','/'+id)).body.data.questions.length,questions.length);
    assert.equal((await call('POST',`/${id}/publish`)).status,200);
    assert.equal((await call('PATCH','/'+id,{title:'Forbidden'})).status,409);
    assert.equal((await call('GET','/available',undefined,account)).body.data.length,1);
    const answers=questions.map((question,index)=>({questionId:question.id,score:index?4:5,comment:index?null:'Nhận xét demo'}));
    assert.equal((await call('POST',`/${id}/responses`,{answers:answers.slice(1)},account)).status,400);
    // Validate the exact deployed functions copied above, without substituting a fix.
    const submitted=await call('POST',`/${id}/responses`,{answers},account);
    assert.equal(submitted.status,201,JSON.stringify(submitted));
    const responseId=submitted.body.data.responseId;
    const expected=Number(((5+(questions.length-1)*4)/questions.length).toFixed(4));
    assert.equal(submitted.body.data.satisfactionScore,expected);
    assert.equal((await call('POST',`/${id}/responses`,{answers},account)).status,409);
    assert.equal((await call('GET','/available',undefined,account)).body.data.length,0);
    assert.equal((await call('GET',`/${id}/my-response`,undefined,account)).body.data.response.satisfactionScore,expected);
    const participants=await call('GET',`/${id}/responses`);assert.equal(participants.body.data.responseCount,1);
    const detail=await call('GET',`/${id}/responses/${responseId}`);assert.equal(detail.body.data.response.answers[0].comment,'Nhận xét demo');
    const results=await call('GET',`/${id}/results`);assert.equal(results.body.data.questions[0].scoreDistribution[5],1);
    await client.query('BEGIN');
    try{
      await client.query('DELETE FROM survey_answers WHERE response_id=$1 AND question_id=$2',[responseId,questions[0].id]);
      await assert.rejects(client.query('COMMIT'),error=>error.code==='23514' && /shared questions/i.test(error.message));
    }finally{await client.query('ROLLBACK');}
    assert.equal((await client.query('SELECT COUNT(*)::int AS n FROM survey_answers WHERE response_id=$1',[responseId])).rows[0].n,questions.length);
    assert.equal((await call('GET',`/${id}/results`,undefined,account)).status,403);
    assert.equal((await call('POST',`/${id}/close`)).body.data.status,'CLOSED');
    assert.equal((await call('GET',`/${id}/my-response`,undefined,account)).status,200);
    assert.equal((await client.query('SELECT COUNT(*)::int AS n FROM survey_questions')).rows[0].n,questions.length);
    console.log('PASS: 12 endpoints, required 1–5 answers, shared bank, satisfactionScore, comments, permissions, draft/publish/close and current DB trigger behavior. TEMP only.');
  }finally{
    if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
    client.release(true);await databasePool.end();
  }
});
