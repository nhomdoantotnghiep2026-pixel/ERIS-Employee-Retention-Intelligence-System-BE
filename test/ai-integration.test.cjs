const test=require('node:test');
const assert=require('node:assert/strict');
const {build,options,FEATURES}=require('../src/modules/ai/ai.features');
const {AiClient,MODEL_ID,SCHEMA,STATUS}=require('../src/modules/ai/ai.client');
const {AiService}=require('../src/modules/ai/ai.service');
const {AppError}=require('../src/common/errors/app-error');
const sample={Department:'IT',Gender:'Male',Age:30,Hire_Date:'2020-10-20',Years_At_Company:6,Education_Level:'Bachelor',Monthly_Salary:1000,Work_Hours_Per_Week:40,Overtime_Hours:5,Sick_Days:2,Promotions:1,Employee_Satisfaction_Score:4};
const row={id:7,employeeCode:'EMP007',fullName:'Synthetic',department:'IT',gender:'MALE',date_of_birth:'1996-11-09',hire_date:'2020-10-20',current_salary:'25000000',education_level:'Bachelor',promotions:1,satisfaction:'4'};
const response=(overrides={})=>({employee_id:'7',model_id:MODEL_ID,schema_version:SCHEMA,validation_status:STATUS,demo_mode:true,score:0.1,target:'Resigned',positive_class:1,base_value:0.1,contributions:Object.fromEntries(FEATURES.map(k=>[k,0])),...overrides});
test('Feature mapping: VN birthday, numeric pg values, explicit FX and provenance',()=>{
 const r=build(row,{vndPerUsd:25000,supplementalFeatures:{}},'2026-11-08');
 assert.equal(r.features.Age,29);assert.equal(r.features.Monthly_Salary,1000);assert.equal(r.features.Employee_Satisfaction_Score,4);
 assert.deepEqual(r.missingFeatures,['Work_Hours_Per_Week','Overtime_Hours','Sick_Days']);
 assert.equal(r.dataSource,'DATABASE');
 assert.equal(build(row,{supplementalFeatures:{}},'2026-11-09').features.Age,30);
});
test('Missing fields are explicit; supplemental values never overwrite database data',()=>{
 const r=build(row,{supplementalFeatures:{Sick_Days:0}},'2026-11-08');
 assert.ok(r.missingFeatures.includes('Monthly_Salary'));assert.equal(r.features.Sick_Days,0);assert.equal(r.dataSource,'MIXED_DEMO');
 assert.throws(()=>build(row,{supplementalFeatures:{Age:40}},'2026-11-08'),/Không ghi đè/);
});
test('Invalid values and future/partial period rejected, no numeric strings or NaN',()=>{
 for(const body of [null,[],{save:'true'},{unexpected:true},{periodStart:'2026-11-01'},{periodStart:'2026-11-01',periodEnd:'2026-11-09'},{vndPerUsd:0},{supplementalFeatures:{Monthly_Salary:-1}},{supplementalFeatures:{Age:'30'}},{supplementalFeatures:{Age:true}},{supplementalFeatures:{Overtime_Hours:NaN}},{supplementalFeatures:{Employee_Satisfaction_Score:6}},{supplementalFeatures:{Hire_Date:'2026-02-30'}}]) assert.throws(()=>options(body,true,'2026-11-08'),AppError);
});
test('Schedule hours exclude overtime; year-to-date totals do not depend on requested period',()=>{
 const opts={periodStart:'2026-11-01',periodEnd:'2026-11-07',supplementalFeatures:{}};
 const r=build({...row,scheduled_weekly_hours:'40',ytd_incomplete_days:'0',ytd_overtime_minutes:'601',absence_days:'3',satisfaction:'3.755'},opts,'2026-11-08');
 assert.equal(r.features.Work_Hours_Per_Week,40);assert.equal(r.features.Overtime_Hours,10.02);
 assert.equal(r.features.Years_At_Company,6);assert.equal(r.features.Sick_Days,3);
 assert.equal(r.features.Employee_Satisfaction_Score,3.75);
 assert.equal(build({...row,hire_date:'2024-11-09'},opts,'2026-11-08').features.Years_At_Company,1);
 const incomplete=build({...row,scheduled_weekly_hours:'40',ytd_incomplete_days:'1',ytd_overtime_minutes:'600'},opts,'2026-11-08');
 assert.ok(incomplete.missingFeatures.includes('Overtime_Hours'));
 assert.equal(incomplete.features.Work_Hours_Per_Week,40);
});
test('AI client: exact ID/model contract and SHAP sum checked, timeout translated',async()=>{
 let sent;
 const client=new AiClient({serviceKey:'a'.repeat(32),fetchImpl:async(_url,opts)=>{sent=opts;return {ok:true,json:async()=>response()};}});
 assert.equal((await client.explain(7,sample)).score,0.1);assert.equal(sent.headers['X-ERIS-Service-Key'],'a'.repeat(32));assert.equal(JSON.parse(sent.body).employee.employee_id,'7');
 for(const bad of [response({employee_id:'8'}),response({score:NaN}),response({model_id:'other'}),response({demo_mode:false}),response({base_value:0.3}),response({contributions:{Age:0.1}})]) {
   client.fetchImpl=async()=>({ok:true,json:async()=>bad});await assert.rejects(()=>client.explain(7,sample),e=>e.statusCode===502);
 }
 client.fetchImpl=async()=>{const e=new Error('timeout');e.name='TimeoutError';throw e;};await assert.rejects(()=>client.explain(7,sample),e=>e.statusCode===504);
 client.serviceKey='';await assert.rejects(()=>client.info(),e=>e.statusCode===503);
});
test('Preview creates a snapshot only when complete; predict reads exact stored snapshot',async()=>{
 let calls=0,writes=0,snapshots=0;
 const stored={snapshotId:3,employee:{id:7},features:sample,missingFeatures:[],invalidFeatures:[],outOfDomainFeatures:[],ready:true};
 const repository={assertHr:async()=>{},read:async()=>row,createSnapshot:async()=>{snapshots++;return 3;},readSnapshot:async(_actor,employeeId,snapshotId)=>{assert.equal(employeeId,7);assert.equal(snapshotId,3);return stored;},save:async()=>{writes++;return {predictionId:9,snapshotId:3};}};
 const service=new AiService({repository,client:{explain:async(_id,features)=>{calls++;assert.deepEqual(features,sample);return response();}},clock:()=>new Date('2026-11-08T12:00:00Z')});
 const missing=await service.preview(1,7,{});assert.equal(missing.snapshotCreated,false);assert.equal(snapshots,0);assert.equal(calls,0);
 const body={vndPerUsd:25000,supplementalFeatures:{Work_Hours_Per_Week:40,Overtime_Hours:5,Sick_Days:2}};
 assert.equal((await service.preview(1,7,body)).snapshotId,3);assert.equal(snapshots,1);
 assert.equal((await service.predict(1,7,{snapshotId:3})).saved,false);assert.equal(snapshots,1);assert.equal(writes,0);
 assert.equal((await service.predict(1,7,{snapshotId:3,save:true})).snapshotId,3);assert.equal(writes,1);assert.equal(snapshots,1);
 await assert.rejects(()=>service.predict(1,7,{supplementalFeatures:{}}),e=>e.statusCode===400);
 repository.readSnapshot=async()=>({...stored,ready:false,missingFeatures:['Age']});await assert.rejects(()=>service.predict(1,7,{snapshotId:3}),e=>e.statusCode===422);
 repository.assertHr=async()=>{throw new AppError(403,'Forbidden');};await assert.rejects(()=>service.predict(1,7,{snapshotId:3}),e=>e.statusCode===403);
});
test('Stored snapshot converts pg numbers without replacing deliberate demo score 0.1',async()=>{
 const {snapshotData}=require('../src/modules/ai/ai.snapshot');
 const values={id:3,employee_id:2,snapshot_date:'2026-11-08T12:00:00Z',department:'IT',gender:'Female',age:50,hire_date:'2026-06-01',years_at_company:'1.00',education_level:'PhD',monthly_salary:'10.00',work_hours_per_week:'100.00',overtime_hours:'200.00',sick_days:'1.00',promotions:0,employee_satisfaction_score:'0.1000'};
 const p=snapshotData(values);assert.equal(p.features.Employee_Satisfaction_Score,0.1);assert.equal(p.ready,true);assert.deepEqual(p.outOfDomainFeatures,['Employee_Satisfaction_Score']);
 assert.equal(snapshotData({...values,monthly_salary:null}).ready,false);
 const client=new AiClient({serviceKey:'a'.repeat(32),fetchImpl:async()=>({ok:true,json:async()=>response()})});
 await assert.rejects(()=>client.explain(7,{...sample,Employee_Satisfaction_Score:0.1}),e=>e.statusCode===422);
 assert.equal((await client.explain(7,{...sample,Employee_Satisfaction_Score:0.1},{allowOutOfRangeDemo:true})).score,0.1);
});
test('Batch: duplicate rejected before inference, 2 workers maximum, per-person errors',async()=>{
 const service=new AiService({repository:{assertHr:async()=>{}},client:{}});
 await assert.rejects(()=>service.batch(1,{employees:[{employeeId:7,snapshotId:3},{employeeId:7,snapshotId:3}]}),e=>e.statusCode===400);
 let running=0,peak=0;
 service.predict=async(_actor,id)=>{running++;peak=Math.max(peak,running);try{await new Promise(r=>setTimeout(r,5));if(id===2)throw new AppError(422,'Missing');return {id};}finally{running--;}};
 const r=await service.batch(1,{employees:[{employeeId:1,snapshotId:1},{employeeId:2,snapshotId:2},{employeeId:3,snapshotId:3}]});
 assert.equal(peak,2);assert.equal(r.succeeded,2);assert.equal(r.failed,1);assert.equal(r.results[1].status,422);assert.equal(r.results[2].employeeId,3);
});
test('HTTP routes require authentication and HR for model/preview',async()=>{
 const express=require('express');const {createAiRouter}=require('../src/modules/ai/ai.routes');const {errorHandler}=require('../src/common/middleware/error-handler');
 const service=new AiService({repository:{assertHr:async actor=>{if(actor!==1)throw new AppError(403,'Forbidden');},read:async()=>row},client:{info:async()=>({model_id:MODEL_ID})}});
 const app=express();app.use(express.json());app.use('/api/ai',createAiRouter({service,repository:service.repository,authenticate:(req,_res,next)=>{if(!req.headers.authorization)return next(new AppError(401,'Unauthorized'));req.auth={userId:Number(req.headers.authorization)};next();}}));app.use(errorHandler);
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 try{const url='http://127.0.0.1:'+server.address().port;
  assert.equal((await fetch(url+'/api/ai/model')).status,401);assert.equal((await fetch(url+'/api/ai/model',{headers:{authorization:'2'}})).status,403);
  const r=await fetch(url+'/api/ai/employees/7/predict',{method:'POST',headers:{authorization:'1','Content-Type':'application/json'},body:'{}'});assert.equal(r.status,400);assert.match((await r.json()).message,/snapshotId/);
 }finally{await new Promise(r=>server.close(r));}
});
test('Real PostgreSQL TEMP tables: save snapshot/result/12 SHAP/audit atomically; failure rolls back',async()=>{
 const {databasePool}=require('../src/config/database');const {AiRepository}=require('../src/modules/ai/ai.repository');
 const client=await databasePool.connect();
 try{
  await client.query(`CREATE TEMP TABLE role(id int PRIMARY KEY,name text);CREATE TEMP TABLE users(id int PRIMARY KEY,role_id int,status text,employee_id int);
    CREATE TEMP TABLE employees(id int PRIMARY KEY,employment_status text,employee_code text,full_name text);
    CREATE TEMP TABLE model_run(id int GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,name text,period_start date,period_end date,status text,total_employees int,model_version text,created_by int,started_at timestamptz,completed_at timestamptz);
    CREATE TEMP TABLE ai_input(id int GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,employee_id int,snapshot_date timestamptz,department text,gender text,age int,hire_date date,years_at_company numeric,education_level text,monthly_salary numeric,work_hours_per_week numeric,overtime_hours numeric,sick_days numeric,promotions int,employee_satisfaction_score numeric);
    CREATE TEMP TABLE prediction_results(id int GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,prediction_run_id int,employee_id int,snapshot_id int,attrition_probability numeric CHECK(attrition_probability BETWEEN 0 AND 1),risk_level text,prediction_label boolean,created_at timestamptz DEFAULT now());
    CREATE TEMP TABLE explainable(id int GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,prediction_result_id int,feature_name text,feature_value text,impact_value numeric,impact_direction text,rank_order int CHECK(rank_order>0),UNIQUE(prediction_result_id,feature_name));
    CREATE TEMP TABLE audit_logs(id int GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,user_id int,entity_type text,entity_id bigint,action text,new_value jsonb);
    INSERT INTO role VALUES(2,'HR');INSERT INTO users VALUES(1,2,'ACTIVE',7);INSERT INTO employees VALUES(7,'ACTIVE','EMP007','Synthetic');`);
  const pool={query:(...a)=>client.query(...a),connect:async()=>({query:(...a)=>client.query(...a),release(){}})};
  const repo=new AiRepository(pool),preview={employee:{id:7},capturedAt:'2026-11-08T12:00:00Z',features:sample,provenance:{Sick_Days:'MANUAL_DEMO'}};
  const snapshotId=await repo.createSnapshot(1,preview);preview.snapshotId=snapshotId;
  const saved=await repo.save(1,preview,response());assert.ok(saved.predictionId);assert.equal(saved.snapshotId,snapshotId);
  assert.equal((await repo.snapshots(1,7)).length,1);
  await assert.rejects(()=>repo.readSnapshot(1,8,snapshotId),e=>e.statusCode===404);
  const counts=(await client.query('SELECT (SELECT count(*) FROM explainable)::int AS explanations,(SELECT count(*) FROM audit_logs)::int AS audits')).rows[0];assert.equal(counts.explanations,12);assert.equal(counts.audits,2);
  const stored=(await client.query('SELECT risk_level,prediction_label FROM prediction_results')).rows[0];assert.equal(stored.risk_level,null);assert.equal(stored.prediction_label,null);
  const reread=await repo.result(1,saved.predictionId);assert.equal(reread.model.model_id,MODEL_ID);assert.equal(reread.preview.provenance.Sick_Days,'MANUAL_DEMO');
  await client.query("ALTER TABLE audit_logs ADD CONSTRAINT reject_audit CHECK(action<>'CREATE') NOT VALID");
  await assert.rejects(()=>repo.save(1,preview,response()));
  const after=(await client.query('SELECT (SELECT count(*) FROM model_run)::int AS runs,(SELECT count(*) FROM prediction_results)::int AS predictions,(SELECT count(*) FROM ai_input)::int AS snapshots')).rows[0];assert.deepEqual(after,{runs:1,predictions:1,snapshots:1});
 }finally{client.release(true);await databasePool.end();}
});
