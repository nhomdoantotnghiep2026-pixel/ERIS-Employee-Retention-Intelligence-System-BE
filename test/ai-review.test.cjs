const {test}=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const {build,years,totalYears}=require('../src/modules/ai-review/ai-review.features');
const {AiReviewService,period,localDay}=require('../src/modules/ai-review/ai-review.service');
const {createAiReviewRouter}=require('../src/modules/ai-review/ai-review.routes');
const {AiReviewClient,ExchangeRateClient,MODEL_IDS}=require('../src/modules/ai-review/ai-review.client');
const {errorHandler}=require('../src/common/middleware/error-handler');
function fixture(){return {id:20,employee_code:'TEST020',full_name:'Hồ sơ kiểm thử',department:'Research & Development',employment_status:'ACTIVE',active_account:true,
  catalog_status:'ACTIVE',position_status:'ACTIVE',hire_date:'2020-01-01',date_of_birth:'2000-12-15',department_id:1,position_id:2,job_level:3,
  current_salary:'25000000',distance_from_home_km:'12.7',educations:[{education_level:'1'},{education_level:'3'}],
  experiences:[{start_date:'2018-01-01',end_date:'2021-01-01'}],
  history:[{start_date:'2020-01-01',position_id:1,department_id:1,change_type:'HIRE'},{start_date:'2025-01-01',position_id:2,department_id:1,change_type:'PROMOTION'}],
  attendance:[{check_in:'2026-10-01',check_out:'2026-10-01',overtime_minutes:60}],
  answers:['JS01','JS02','JS03','JS04','ES01','ES02','ES03','ES04'].map(dimension_code=>({dimension_code,score:3}))};}
test('age, local date, previous calendar month and non-overlapping experience',()=>{
 assert.equal(years('2000-12-15','2026-11-02'),25);assert.equal(years('2000-12-15','2026-12-15'),26);
 assert.equal(localDay(new Date('2026-11-01T18:00:00Z')),'2026-11-02');
 assert.deepEqual(period('2026-01-05'),{startInclusive:'2025-12-01',endExclusive:'2026-01-01'});
 assert.equal(totalYears([['2020-01-01',null],['2021-01-01','2023-01-01']],'2026-01-01'),6);
 assert.equal(totalYears([['2020-01-01','2020-12-31']],'2026-01-01'),1);
});
test('approved mappings, merged experience and promotion reset role tenure',()=>{
 const f=build(fixture(),'2026-11-02',{vndPerUsd:25000});
 assert.equal(f.MonthlyIncome,1000);assert.equal(f.DistanceFromHome,13);assert.equal(f.Education,4);
 assert.equal(f.YearsInCurrentRole,1);assert.equal(f.YearsSinceLastPromotion,1);assert.equal(f.TotalWorkingYears,8);assert.equal(f.OverTime,'Yes');
 const row=fixture();row.history[1].change_type='ROLE_CHANGE';assert.equal(build(row,'2026-11-02',{vndPerUsd:25000}).YearsSinceLastPromotion,6);
});
test('never impute missing required data or merge duplicate questionnaire dimensions',()=>{
 for(const [patch,reason] of [[{department:'Marketing'},'UNSUPPORTED_DEPARTMENT'],[{distance_from_home_km:null},'DISTANCE'],[{attendance:[]},'ATTENDANCE'],[{answers:[]},'SURVEY'],[{educations:[]},'EDUCATION']]){
  assert.throws(()=>build({...fixture(),...patch},'2026-11-02',{vndPerUsd:25000}),new RegExp(reason));
 }
 const row=fixture();row.answers.push(row.answers[0]);assert.throws(()=>build(row,'2026-11-02',{vndPerUsd:25000}),/SURVEY/);
 row.answers=fixture().answers;row.attendance[0].check_out=null;assert.throws(()=>build(row,'2026-11-02',{vndPerUsd:25000}),/INCOMPLETE/);
 assert.throws(()=>build(fixture(),'2026-11-02',{vndPerUsd:0}),/EXCHANGE_RATE/);
});
test('FX uses single-flight cache and rejects stale/provider errors',async()=>{
 let calls=0;const now=Date.parse('2026-11-02T12:00:00Z');
 const c=new ExchangeRateClient({now:()=>now,fetchImpl:async()=>{calls++;return {ok:true,json:async()=>({result:'success',base_code:'USD',rates:{VND:25000},time_last_update_unix:now/1000-60})};}});
 await Promise.all([c.get(),c.get()]);await c.get();assert.equal(calls,1);
 const bad=new ExchangeRateClient({now:()=>now,fetchImpl:async()=>({ok:true,json:async()=>({result:'success',base_code:'USD',rates:{VND:25000},time_last_update_unix:now/1000-4*86400})})});
 await assert.rejects(()=>bad.get(),e=>e.statusCode===503);
});
test('client does not leak credentials/upstream exceptions and rejects mismatched responses',async()=>{
 const c=new AiReviewClient({key:'not-a-real-secret',fetchImpl:async()=>({ok:false,status:500,json:async()=>({password:'bad'})})});
 await assert.rejects(()=>c.models(),e=>e.statusCode===503&&!e.message.includes('not-a-real-secret'));
 const bad=new AiReviewClient({key:'x',fetchImpl:async()=>({ok:true,json:async()=>({request_id:'wrong',result:{}})})});
 await assert.rejects(()=>bad.predict({request_id:'expected',reference_id:'a',model_id:MODEL_IDS[0]}),e=>e.statusCode===502);
});
test('HTTP HR authorization, self denial, validation and partial explain failure',async()=>{
 let role='HR',status='ACTIVE',actorEmployee=99,calls=0;
 const repository={actor:async()=>({id:1,role,status,employeeId:actorEmployee}),snapshots:async()=>[fixture()]};
 const modelClient={models:async()=>({models:[]}),predict:async b=>{calls++;assert.equal(b.reference_id.includes('TEST020'),false);return {estimatedProbability:0.2,metadata:{modelId:b.model_id}};},explain:async()=>{throw new Error('secret upstream');}};
 const service=new AiReviewService({repository,modelClient,exchangeRates:{get:async()=>({vndPerUsd:25000})},now:()=>new Date('2026-11-02T12:00:00Z')});
 const app=express();app.use(express.json());app.use('/api/ai-review',createAiReviewRouter({service,authenticate:(req,res,next)=>{if(!req.get('Authorization'))return res.status(401).end();req.auth={userId:1};next();}}));app.use(errorHandler);
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const base='http://127.0.0.1:'+server.address().port+'/api/ai-review';
 async function request(route,body){return fetch(base+route,{method:body?'POST':'GET',headers:{Authorization:'Bearer fixture','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});}
 try{
  assert.equal((await fetch(base+'/inputs')).status,401);
  role='EMPLOYEE';assert.equal((await request('/inputs')).status,403);role='ADMIN';assert.equal((await request('/sample',{})).status,403);
  role='HR';status='INACTIVE';assert.equal((await request('/models')).status,403);status='ACTIVE';
  assert.equal((await request('/predict',{employeeId:'20'})).status,400);assert.equal((await request('/sample',{features:{}})).status,400);
  actorEmployee=20;assert.equal((await request('/predict',{employeeId:20})).status,422);assert.equal(calls,0);actorEmployee=99;
  const r=await request('/predict',{employeeId:20});assert.equal(r.status,200);assert.match(r.headers.get('cache-control'),/no-store/);
  const result=(await r.json()).data;assert.equal(result.persisted,false);assert.equal(result.estimatedProbability,0.2);assert.equal(result.explanation,null);assert.ok(result.explanationError);assert.equal(JSON.stringify(result).includes('secret upstream'),false);
  const sample=await request('/sample',{includeExplanation:false});assert.equal((await sample.json()).data.synthetic,true);
 }finally{await new Promise(r=>server.close(r));}
});
test('batch uses one upstream call, preserves order and skips self/unsupported/missing IDs',async()=>{
 let calls=0;const row=fixture();
 const service=new AiReviewService({repository:{actor:async()=>({status:'ACTIVE',role:'HR',employeeId:99}),snapshots:async()=>[row,{...row,id:21,department:'Marketing'},{...row,id:99}]},
  exchangeRates:{get:async()=>({vndPerUsd:25000})},now:()=>new Date('2026-11-02T12:00:00Z'),
  modelClient:{batch:async b=>{calls++;assert.equal(new Set(b.items.map(x=>x.reference_id)).size,b.items.length);return b.items.map(()=>({estimatedProbability:0.25,metadata:{modelId:b.model_id}}));}}});
 const real=(await service.batch(1,{employeeIds:[21,20,99,404]})).data;
 assert.equal(calls,1);assert.equal(real.successCount,1);assert.equal(real.results[0].employee.id,20);assert.equal(real.skippedCount,3);
 const sample=(await service.batch(1,{},true)).data;assert.equal(calls,2);assert.equal(sample.results.length,10);assert.deepEqual(sample.results.map(r=>r.sampleIndex),[0,1,2,3,4,5,6,7,8,9]);
 assert.ok(sample.results.every(r=>r.synthetic&&r.persisted===false));
 const {validateBatch,validate}=require('../src/modules/ai-review/ai-review.routes');
 for(const ids of [[],[1,1],[0],['1'],Array.from({length:101},(_,i)=>i+1)])assert.throws(()=>validateBatch({employeeIds:ids},false));
 assert.throws(()=>validate({sampleIndex:10},true));
});
test('client batch checks response order and correspondence',async()=>{
 const hash='0c72841a8505a910d31c2a687fbcbf5259e3afb60f9eddcb7586801519b5628f';
 const body={model_id:MODEL_IDS[0],request_id:'request',items:[{reference_id:'a'},{reference_id:'b'}]};
 let wrong=false;
 const client=new AiReviewClient({key:'fixture',fetchImpl:async()=>({ok:true,json:async()=>({request_id:'request',results:(wrong?['b','a']:['a','b']).map(reference_id=>({reference_id,estimated_probability:0.1,imputed_features:[],metadata:{model_id:MODEL_IDS[0],model_sha256:hash,feature_schema_version:'v3_final_15'}}))})})});
 assert.equal((await client.batch(body)).length,2);wrong=true;await assert.rejects(()=>client.batch(body),e=>e.statusCode===502);
});
