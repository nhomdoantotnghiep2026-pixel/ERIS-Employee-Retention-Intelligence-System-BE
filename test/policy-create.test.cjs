const {test}=require('node:test'),assert=require('node:assert/strict');
const {PolicyDemoRepository}=require('../src/modules/prediction_results/policy-demo.repository');
const {validatePolicyCreate}=require('../src/modules/prediction_results/helpers/policy-create.validation');
const {createPolicyDemoRouter}=require('../src/modules/prediction_results/policy-demo.routes');
const {errorHandler}=require('../src/common/middleware/error-handler');
test('recommendations read target factors from the recommendation record', async () => {
 const client = { async query(sql) {
  assert.match(sql, /r\.target_factor AS "targetFactor"/);
  assert.doesNotMatch(sql, /p\.target_factor/);
  return { rows: [{ id: 1, policyId: 2, probability: '0.78', targetFactor: 'overtime_hours' },
    { id: 3, policyId: 2, probability: '0.55', targetFactor: null }] };
 } };
 const result = await new PolicyDemoRepository(client).readRecommendations(client);
 assert.deepEqual(result.map(item => item.policy.targetFactor), ['overtime_hours', null]);
});

const valid=()=>({code:'RETENTION_WORKLOAD_REVIEW',name:'Rà soát khối lượng công việc',description:'HR trao đổi về phân bổ nhiệm vụ.\nKiểm tra lại sau 30 ngày.'});
function fixture(){
 const state={policies:[],audit:[],queries:[],released:0,failAudit:false,uniqueError:false};let snapshot;
 const db={release(){state.released++;},async query(sql,args=[]){
  state.queries.push({sql,args});assert(!/CREATE TABLE|ALTER TABLE|CREATE TEMP/.test(sql));
  if(sql==='BEGIN'){snapshot=structuredClone({policies:state.policies,audit:state.audit});return {rows:[]};}
  if(sql==='ROLLBACK'){state.policies=snapshot.policies;state.audit=snapshot.audit;return {rows:[]};}
  if(sql.includes('FROM users u'))return {rows:args[0]===1?[{id:1}]:[]};
  if(sql.includes('upper(btrim(code))'))return {rows:state.policies.filter(p=>p.code.trim().toUpperCase()===args[0])};
  if(sql.startsWith('INSERT INTO retention_policies')){
   if(state.uniqueError)throw Object.assign(new Error('duplicate code'),{code:'23505',constraint:'retention_policies_code_key'});
   const row={id:String(9007199254740993n+BigInt(state.policies.length)),code:args[0],name:args[1],description:args[2],status:args[3],createdAt:'2026-11-19T09:00:00+07:00',updatedAt:'2026-11-19T09:00:00+07:00'};state.policies.push(row);return {rows:[row]};
  }
  if(sql.startsWith('INSERT INTO audit_logs')){if(state.failAudit)throw new Error('audit unavailable');state.audit.push({actor:args[0],entity:args[1],id:args[2],action:args[3],old:args[4],value:JSON.parse(args[5])});return {rows:[]};}
  if(sql.includes('FROM retention_policies'))return {rows:args.length?state.policies.filter(p=>p.id===args[0]):state.policies};
  return {rows:[]};
 }};
 return {state,repo:new PolicyDemoRepository({...db,connect:async()=>db})};
}
test('validator normalizes policy fields without binding the catalogue to model factors',()=>{
 const result=validatePolicyCreate({...valid(),code:' p31 ',name:' Rà soát '});
 assert.equal(result.code,'P31');assert.equal(result.name,'Rà soát');assert.equal(result.status,'ACTIVE');
 assert.equal(Object.hasOwn(result,'targetFactor'),false);
 assert.equal(validatePolicyCreate({...valid(),status:'INACTIVE'}).status,'INACTIVE');
 assert.throws(()=>validatePolicyCreate({...valid(),targetFactor:'overtime_hours'}),e=>e.statusCode===400);
});
test('validator rejects missing/blank/overlong values, extra fields, invalid factors/status and control characters',()=>{
 const cases=[null,[],{},'policy',...['code','name','description'].flatMap(k=>[{...valid(),[k]:null},{...valid(),[k]:'   '},{...valid(),[k]:12}]),
 {...valid(),code:'P'.repeat(101)},{...valid(),name:'N'.repeat(151)},{...valid(),description:'x'.repeat(10001)},
 {...valid(),code:'not valid'},{...valid(),code:'_BAD'},{...valid(),targetFactor:'salary'},{...valid(),targetFactor:''},{...valid(),targetFactor:[]},{...valid(),status:'DRAFT'},
 ...['id','createdBy','created_at','userId','reason','priority'].map(k=>({...valid(),[k]:1})),{...valid(),name:'A\nB'},{...valid(),description:'A\u0000B'}];
 for(const b of cases)assert.throws(()=>validatePolicyCreate(b),e=>e.statusCode===400);
 assert.doesNotThrow(()=>validatePolicyCreate({...valid(),name:'A'.repeat(149)+'😀'}));
});
test('HR create uses actual table columns and writes actor audit atomically, bigint ID preserved',async()=>{
 const {repo,state}=fixture(),result=await repo.createPolicy(1,valid());assert.equal(result.data.id,'9007199254740993');assert.equal(state.policies.length,1);assert.equal(state.audit.length,1);assert.deepEqual(state.audit[0],{actor:1,entity:'retention_policies',id:result.data.id,action:'CREATE',old:null,value:result.data});assert.equal(state.released,1);
 const insert=state.queries.find(q=>q.sql.startsWith('INSERT INTO retention_policies'));assert.equal(insert.args.length,4);assert(!/target_factor|created_by|reason|priority/.test(insert.sql));assert(!state.queries.some(q=>/INSERT INTO policy_recommendations|UPDATE retention_policies/.test(q.sql)));assert.equal(state.queries.at(-1).sql,'COMMIT');
 assert.equal((await repo.policies(1,result.data.id)).data.id,result.data.id);
});
test('non-HR and inactive accounts cannot create, including malformed bodies',async()=>{
 for(const actor of [2,3,4]){const {repo,state}=fixture();await assert.rejects(repo.createPolicy(actor,{}),e=>e.statusCode===403);assert.equal(state.policies.length,0);assert.equal(state.queries.at(-1).sql,'ROLLBACK');}
});
test('duplicate code is rejected case-insensitively even when INACTIVE, without overwrite',async()=>{
 const {repo,state}=fixture();state.policies=[{id:'5',code:' retention_workload_review ',status:'INACTIVE'}];await assert.rejects(repo.createPolicy(1,valid()),e=>e.statusCode===409);assert.equal(state.policies[0].status,'INACTIVE');assert.equal(state.audit.length,0);
 assert(state.queries.findIndex(q=>q.sql.includes('pg_advisory_xact_lock'))<state.queries.findIndex(q=>q.sql.includes('upper(btrim(code))')));
 state.uniqueError=true;state.policies=[];await assert.rejects(repo.createPolicy(1,valid()),e=>e.statusCode===409);assert.equal(state.policies.length,0);
});
test('audit failure rolls back policy creation and releases transaction',async()=>{const {repo,state}=fixture();state.failAudit=true;await assert.rejects(repo.createPolicy(1,valid()),/audit unavailable/);assert.equal(state.policies.length,0);assert.equal(state.audit.length,0);assert.equal(state.queries.at(-1).sql,'ROLLBACK');assert.equal(state.released,1);});
test('free text is sent as SQL parameters; invalid payload never inserts',async()=>{const {repo,state}=fixture(),name="Policy '; DROP TABLE users; --";await repo.createPolicy(1,{...valid(),name});assert.equal(state.policies[0].name,name);assert(!state.queries.some(q=>q.sql.includes('DROP TABLE')));await assert.rejects(repo.createPolicy(1,{...valid(),reason:'not policy content'}),e=>e.statusCode===400);assert.equal(state.policies.length,1);});
test('POST contract: 201/Location, authorization, validation, duplicates and GET visibility',async()=>{
 const express=require('express'),{repo,state}=fixture(),app=express();app.use(express.json());
 app.use('/api',createPolicyDemoRouter({repository:repo,authenticate:(req,res,next)=>{if(!req.headers.authorization)return res.status(401).json({message:'Access token required.'});req.auth={userId:Number(req.headers.authorization)};next();}}));app.use(errorHandler);
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 try{
  const url=`http://127.0.0.1:${server.address().port}/api/retention-policies`,post=(body,auth='1')=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json',...(auth?{Authorization:auth}:{})},body:JSON.stringify(body)});
  assert.equal((await post(valid(),'')).status,401);assert.equal((await post(valid(),'2')).status,403);assert.equal((await post({})).status,400);
  const response=await post(valid()),body=await response.json();assert.equal(response.status,201);assert.equal(response.headers.get('Location'),'/api/retention-policies/'+body.data.id);assert.equal(body.data.status,'ACTIVE');assert.equal((await post(valid())).status,409);
  const listed=await (await fetch(url,{headers:{Authorization:'1'}})).json();assert.equal(listed.data[0].id,body.data.id);assert.equal(state.policies.length,1);
  assert.equal((await (await fetch(response.headers.get('Location').replace('/api/retention-policies',url),{headers:{Authorization:'1'}})).json()).data.code,valid().code);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
test('Swagger documents create without losing existing policy GET routes',()=>{
 const {policyDemoPaths}=require('../src/modules/prediction_results/policy-demo.swagger'),p=policyDemoPaths['/api/retention-policies'];assert(p.get);assert(p.post.responses[201]);assert(p.post.responses[409]);assert(policyDemoPaths['/api/retention-policies/{id}'].get);const schema=p.post.requestBody.content['application/json'].schema;assert.deepEqual(schema.required,['code','name','description']);assert.equal(schema.additionalProperties,false);assert.equal(schema.properties.targetFactor,undefined);
});
