const test=require('node:test'),assert=require('node:assert/strict');
const {recommend,DRAFTS}=require('../src/modules/ai/ai-policy.rules');
const {MODEL_ID,SCHEMA,STATUS}=require('../src/modules/ai/ai.client');
const {AiPolicyRepository}=require('../src/modules/ai/ai-policy.repository');
const {FEATURES}=require('../src/modules/ai/ai.features');
const {AppError}=require('../src/common/errors/app-error');
function fixture(changes={}){
 const contributions=Object.fromEntries(FEATURES.map(k=>[k,0]));Object.assign(contributions,{Age:0.01,Gender:0.01,Hire_Date:0.04,Overtime_Hours:0.02,Work_Hours_Per_Week:0.015,Employee_Satisfaction_Score:0.03,Monthly_Salary:0.02,Sick_Days:0.01,Promotions:0.005},changes.contributions);
 const features={Department:'IT',Gender:'Male',Age:30,Hire_Date:'2020-01-01',Years_At_Company:6,Education_Level:'Bachelor',Monthly_Salary:1000,Work_Hours_Per_Week:40,Overtime_Hours:5,Sick_Days:2,Promotions:0,Employee_Satisfaction_Score:2,...changes.features};
 return {predictionId:1,model:{model_id:MODEL_ID,schema_version:SCHEMA,validation_status:STATUS,demo_mode:true,base_value:0.1,score:0.1+Object.values(contributions).reduce((a,b)=>a+b,0),contributions},preview:{employee:{id:2},snapshotId:3,features,provenance:{Overtime_Hours:'MANUAL_DEMO'}}};
}
const catalog=DRAFTS.map((p,i)=>({...p,id:i+1,status:'ACTIVE'}));

test('Policy description contains content only; recommendation reason owns the review condition',()=>{
 assert.ok(DRAFTS.every(policy=>policy.description===policy.action));
 const row=recommend(fixture(),catalog,{limit:12}).recommendations[0];
 assert.match(row.reason,/^Điều kiện xem xét:/);
 assert.ok(!row.reason.includes(row.policy.description));
});

test('All 12 positive features map to separate ACTIVE V2 policies, including categorical features',()=>{
 const contributions=Object.fromEntries(FEATURES.map((k,i)=>[k,(i+1)/10000]));
 const r=recommend(fixture({contributions}),catalog,{limit:12});
 assert.equal(r.ruleVersion,'SHAP_FEATURE_REVIEW_V2');assert.equal(r.recommendations.length,12);
 assert.equal(new Set(r.recommendations.map(x=>x.policy.id)).size,12);
 assert.ok(r.recommendations.every(x=>x.signals.length===1&&x.requiresHrConfirmation&&x.priority==='MEDIUM'));
 assert.deepEqual(new Set(r.recommendations.map(x=>x.signals[0].feature)),new Set(FEATURES));
 assert.equal(r.recommendations[0].signals[0].feature,FEATURES.at(-1));
 const ot=r.recommendations.find(x=>x.signals[0].feature==='Overtime_Hours');
 const hours=r.recommendations.find(x=>x.signals[0].feature==='Work_Hours_Per_Week');
 assert.notEqual(ot.policy.id,hours.policy.id);assert.equal(ot.signals[0].source,'MANUAL_DEMO');
 assert.equal(r.autoApplied,false);assert.equal(r.omittedCount,0);
 assert.match(r.recommendations.find(x=>x.signals[0].feature==='Sick_Days').reason,/ON_LEAVE \+ ABSENT/);
});
test('Negative and zero SHAP never trigger; default limit stays 3 and maximum is 12',()=>{
 const contributions=Object.fromEntries(FEATURES.map(k=>[k,-0.001]));contributions.Age=0;
 assert.equal(recommend(fixture({contributions}),catalog,{limit:12}).recommendations.length,0);
 const all=Object.fromEntries(FEATURES.map(k=>[k,0.001]));
 const r=recommend(fixture({contributions:all}),catalog);assert.equal(r.recommendations.length,3);assert.equal(r.omittedCount,9);
 for(const limit of [0,13,1.5,'12'])assert.throws(()=>recommend(fixture(),catalog,{limit}),e=>e.statusCode===400);
});
test('Out-of-domain values excluded, valid high satisfaction and previous promotions do not invent thresholds',()=>{
 const r=recommend(fixture({features:{Employee_Satisfaction_Score:0.1}}),catalog,{limit:12});
 assert.ok(!r.recommendations.some(x=>x.signals[0].feature==='Employee_Satisfaction_Score'));
 assert.ok(r.excludedFactors.some(x=>x.feature==='Employee_Satisfaction_Score'));
 const high=recommend(fixture({features:{Employee_Satisfaction_Score:5,Promotions:2}}),catalog,{limit:12});
 assert.ok(high.recommendations.some(x=>x.signals[0].feature==='Employee_Satisfaction_Score'));
 assert.ok(high.recommendations.some(x=>x.signals[0].feature==='Promotions'));
 assert.match(high.recommendations.find(x=>x.signals[0].feature==='Employee_Satisfaction_Score').reason,/Điểm hài lòng thấp/);
});
test('Only ACTIVE catalogue, prefer exact V2 code, missing policy is draft; reject invalid SHAP or model',()=>{
 const r=recommend(fixture(),catalog.map(p=>({...p,status:'INACTIVE'})),{limit:3});assert.equal(r.recommendations.length,3);
 assert.ok(r.recommendations.every(x=>!x.policy&&x.policyDraft&&x.status==='AWAITING_POLICY_APPROVAL'));
 const extra={...catalog[0],id:999,code:'LEGACY',targetFactor:'DEPARTMENT'};
 const selection=recommend(fixture({contributions:{Department:0.02}}),[extra,...catalog],{limit:12});
 assert.equal(selection.recommendations.find(x=>x.signals[0].feature==='Department').policy.code,catalog[0].code);
 const result=fixture();result.model.model_id='DEMO_FIXED_POLICY_V1';assert.throws(()=>recommend(result,catalog),e=>e.statusCode===409);
 const corrupted=fixture();corrupted.model.score=0.99;assert.throws(()=>recommend(corrupted,catalog),e=>e.statusCode===409);
 const missing=fixture();delete missing.model.contributions.Department;assert.throws(()=>recommend(missing,catalog),e=>e.statusCode===409);
});
function fakeDb(){
 const state={recommendations:[],audits:[],policies:structuredClone(catalog),active:true,failAudit:false,backup:null};
 const query=async(sql,values=[])=>{
  if(sql==='BEGIN'){state.backup=structuredClone({recommendations:state.recommendations,audits:state.audits});return {rows:[]};}
  if(sql==='ROLLBACK'){Object.assign(state,state.backup);return {rows:[]};}
  if(sql==='COMMIT')return {rows:[]};
  if(sql.includes('pg_advisory_xact_lock'))return {rows:[]};
  if(sql.includes('FROM retention_policies'))return {rows:state.policies.filter(p=>p.status==='ACTIVE')};
  if(sql.includes('FROM prediction_results'))return {rows:state.active?[{id:1}]:[]};
  if(sql.startsWith('SELECT id,status FROM policy_recommendations'))return {rows:state.recommendations.filter(r=>r.prediction_result_id===values[0]&&r.policy_id===values[1])};
  if(sql.startsWith('INSERT INTO policy_recommendations')){const r={id:state.recommendations.length+1,prediction_result_id:values[0],policy_id:values[1],status:'SUGGESTED'};state.recommendations.push(r);return {rows:[r]};}
  if(sql.startsWith('INSERT INTO audit_logs')){if(state.failAudit)throw new Error('Audit failed');state.audits.push(values);return {rows:[]};}
  throw new Error('Unexpected SQL: '+sql);
 };
 return {state,query,connect:async()=>({query,release(){}})};
}
const ai={assertHr:async actor=>{if(actor!==1)throw new AppError(403,'HR only');},result:async()=>fixture()};
test('Preview does not write; save is idempotent and never inserts catalogue policies',async()=>{
 const pool=fakeDb(),repo=new AiPolicyRepository(pool,ai);
 const preview=await repo.generate(1,1,{});assert.equal(preview.saved,false);assert.equal(pool.state.recommendations.length,0);
 const saved=await repo.generate(1,1,{save:true});assert.equal(saved.savedRecommendations.length,3);assert.equal(pool.state.audits.length,3);
 pool.state.recommendations[0].status='APPROVED';const again=await repo.generate(1,1,{save:true});assert.equal(pool.state.recommendations.length,3);assert.ok(again.savedRecommendations.every(x=>!x.created));assert.equal(again.savedRecommendations[0].status,'APPROVED');
 assert.equal(pool.state.policies.length,12);
});
test('Rollback on audit failure, permission, input and inactive employee validation',async()=>{
 const pool=fakeDb(),repo=new AiPolicyRepository(pool,ai);pool.state.failAudit=true;
 await assert.rejects(()=>repo.generate(1,1,{save:true}),/Audit failed/);assert.equal(pool.state.recommendations.length,0);assert.equal(pool.state.audits.length,0);
 await assert.rejects(()=>repo.generate(2,1,{}),e=>e.statusCode===403);
 for(const body of [null,[],{limit:0},{limit:13},{save:'true'},{policyId:999}])await assert.rejects(()=>repo.generate(1,1,body),e=>e.statusCode===400);
 pool.state.active=false;await assert.rejects(()=>repo.generate(1,1,{}),e=>e.statusCode===409);
});
test('HTTP endpoint: authentication, HR, default preview and malformed ID/body',async()=>{
 const express=require('express'),{createAiRouter}=require('../src/modules/ai/ai.routes'),{errorHandler}=require('../src/common/middleware/error-handler');
 const pool=fakeDb(),repo=new AiPolicyRepository(pool,ai),app=express();app.use(express.json());app.use('/api/ai',createAiRouter({service:{},repository:ai,policyRepository:repo,authenticate:(req,_res,next)=>{if(!req.headers.authorization)return next(new AppError(401,'Unauthorized'));req.auth={userId:Number(req.headers.authorization)};next();}}));app.use(errorHandler);
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));try{
 const call=(id,body,actor)=>fetch('http://127.0.0.1:'+server.address().port+'/api/ai/results/'+id+'/policy-recommendations',{method:'POST',headers:{'Content-Type':'application/json',...(actor?{authorization:String(actor)}:{})},body:JSON.stringify(body)});
 assert.equal((await call(1,{},null)).status,401);assert.equal((await call(1,{},2)).status,403);assert.equal((await call('abc',{},1)).status,400);
 const response=await call(1,{},1);assert.equal(response.status,200);assert.equal((await response.json()).data.saved,false);assert.equal(pool.state.recommendations.length,0);
 }finally{await new Promise(r=>server.close(r));}
});
