const {test}=require('node:test');const assert=require('node:assert/strict');
const {UnifiedAnalysis,OllamaProvider}=require('../src/modules/ai/services/ai-unified.service');

test('Qwen returns two distinct E5 policies with their respective evidence', async () => {
 const candidates = ['1', '2'].map(policyId => ({
  policyId, policy: { id: policyId, name: `Policy ${policyId}` },
  evidence: [{ id: `survey-${policyId}`, source: 'SURVEY', comment: `Observation ${policyId}` }]
 }));
 const recommendations = candidates.map(({ policyId, evidence }) => ({
  policyId, evidenceIds: [evidence[0].id], reason: 'Xem lại phản hồi khảo sát.', hrVerification: 'Hỏi thêm nhân viên.'
 }));
 const writer = new OllamaProvider({ url: 'http://localhost:11434', model: 'qwen-test', fetchImpl: async (url, options) => {
  const { format } = JSON.parse(options.body);
  assert.equal(format.properties.recommendations.minItems, 2);
  assert.equal(format.properties.recommendations.maxItems, 2);
  return { ok: true, text: async () => JSON.stringify({ done: true, done_reason: 'stop', message: {
   content: JSON.stringify({ recommendations, noRecommendationReason: null })
  } }) };
 } });
 const analysis = new UnifiedAnalysis({}, {}, { agent: {}, writer });
 const result = await analysis.writeRecommendations(candidates, {}, {});
 assert.deepEqual(result.recommendations.map(item => item.policyId), ['1', '2']);

 recommendations[1].evidenceIds = recommendations[0].evidenceIds;
 await assert.rejects(analysis.writeRecommendations(candidates, {}, {}), /linked evidence/);
 recommendations.pop();
 await assert.rejects(analysis.writeRecommendations(candidates, {}, {}), /shortlisted policy/);
});
function fixture(){
 const preview={ready:true,snapshotId:3,capturedAt:'2026-11-20T00:00:00Z',employee:{id:7},period:{start:'2026-11-01',end:'2026-11-19'},features:{Overtime_Hours:20}};
 const policy={id:'1',code:'P01',name:'Support',description:'Review workload'};
 const context={policies:[policy],evidence:[{id:'SURVEY:1:2',source:'SURVEY'},{id:'ATTENDANCE:1',source:'ATTENDANCE'}]};let predict=0,save=0,call=0,retrieve=0,contexts=0;const settings={};
 const repo={pool:{query:async()=>({rows:[{survey_id:1}]})},assertHr:async()=>{},readSnapshot:async()=>preview,save:async(a,p,m,analysis)=>{save++;assert.equal(analysis.recommendations.length,1);return {predictionId:8};}};
 const service={predict:async(a,e,b)=>{predict++;assert.equal(b.save,false);return {preview,model:{score:0.2,contributions:{Overtime_Hours:0.1}}};}};
 const provider={name:'OLLAMA',model:'test-local',configured:()=>true,generate:async c=>{call++;assert.equal(c.model.enabled,true);assert.equal(c.retrieval.provider,'E5');assert(c.evidence.some(e=>e.id==='MODEL:Overtime_Hours'));if(settings.fail)throw Error('offline');return {recommendations:[{policyId:settings.bad?'999':'1',reason:'Review evidence',evidenceIds:['SURVEY:1:2','MODEL:Overtime_Hours'],hrVerification:'Verify workload'}],noRecommendationReason:null};}};
 const retriever={name:'E5',model:'test-e5',configured:()=>true,rank:async()=>{retrieve++;return {recommendations:[{policyId:'1',similarity:0.8,evidence:[context.evidence[0]]}],noRecommendationReason:null};}};
 const agent={context:async()=>({context,fingerprint:++contexts>1&&settings.stale?'changed':'same'})};
 return {u:new UnifiedAnalysis(service,repo,{agent,provider,retriever}),settings,repo,provider,retriever,counts:()=>({predict,save,call,retrieve})};
}
const body={snapshotId:3,save:true,confirmExternalData:true};
test('recommendation validation accepts two grounded policies and rejects a third',()=>{
 const {validateOutput}=require('../src/modules/policy-agent/policy-agent.service');
 const policies=['1','2','3'].map(id=>({id,code:'P0'+id,name:'Support '+id}));
 const context={policies,evidence:[{id:'SURVEY:1:2',source:'SURVEY'}]};
 const recommendations=policies.map(p=>({policyId:p.id,reason:'Specific observed difficulty and why this support fits.',evidenceIds:['SURVEY:1:2'],hrVerification:'Ask the employee which tasks have conflicting priorities.'}));
 assert.equal(validateOutput({recommendations:recommendations.slice(0,2),noRecommendationReason:null},context).recommendations.length,2);
 assert.throws(()=>validateOutput({recommendations,noRecommendationReason:null},context),e=>e.statusCode===502);
});
test('Ollama uses non-thinking compact defaults and identifies HTTP timeout versus connection errors',async()=>{
 let payload;
 const provider=new OllamaProvider({url:'http://localhost:11434',model:'qwen3:8b',fetchImpl:async(_url,options)=>{
  payload=JSON.parse(options.body);assert.equal(options.signal,undefined);
  return {ok:true,text:async()=>JSON.stringify({done:true,done_reason:'stop',message:{content:JSON.stringify({recommendations:[],noRecommendationReason:'No evidence'})}})};
 }});
 await provider.generate({});
 assert.equal(payload.think,false);assert.equal(payload.keep_alive,'15m');
 assert.match(payload.messages[0].content,/Answer in Vietnamese\./);
 assert.match(payload.messages[0].content,/1-2 short sentences/);
 assert.match(payload.messages[0].content,/one focused question/);
 assert.equal(payload.options.num_ctx,8192);assert.equal(payload.options.num_predict,768);
 for(const [code,status] of [['UND_ERR_HEADERS_TIMEOUT',504],['ECONNRESET',502]]){
  provider.fetchImpl=async()=>{throw Object.assign(new TypeError('fetch failed'),{cause:{code}});};
  await assert.rejects(provider.generate({}),error=>error.statusCode===status);
 }
 provider.fetchImpl=async()=>({ok:true,text:async()=>{throw Object.assign(new Error('body timeout'),{code:'UND_ERR_BODY_TIMEOUT'});}});
 await assert.rejects(provider.generate({}),error=>error.statusCode===504);
});
test('policy code from database context survives Ollama mapping in preview and persistence',async()=>{
 for(const save of [false,true]){
  const f=fixture();
  const generate=f.provider.generate;
  f.provider.generate=async context=>{assert.equal(context.policies[0].code,'P01');return generate(context);};
  const persist=f.repo.save;
  f.repo.save=async(...args)=>{assert.equal(args[3].recommendations[0].policy.code,'P01');return persist(...args);};
  const result=await f.u.run(1,'7',{...body,save});
  assert.equal(result.policyAnalysis.recommendations[0].policy.code,'P01');
 }
});
test('E5 retrieval and Ollama generation combine all sources; save is last',async()=>{const f=fixture();const r=await f.u.run(1,'7',body);assert.equal(r.saved,true);assert.equal(r.predictionId,8);assert.equal(r.policyAnalysis.provider,'E5+OLLAMA');assert.equal(r.policyAnalysis.autoApplied,false);assert.deepEqual(f.counts(),{predict:1,save:1,call:1,retrieve:1});});
test('preview never writes; invalid output, source changes and provider errors never save',async()=>{const preview=fixture();assert.equal((await preview.u.run(1,'7',{...body,save:false})).saved,false);assert.equal(preview.counts().save,0);for(const key of ['bad','stale','fail']){const f=fixture();f.settings[key]=true;await assert.rejects(f.u.run(1,'7',body));assert.equal(f.counts().save,0);assert.equal(f.u.busy.size,0);}});
test('reject consent/unknown fields/missing provider config before prediction; HR remains required',async()=>{for(const b of [{...body,confirmExternalData:false},{...body,extra:1},{...body,snapshotId:0}]){const f=fixture();await assert.rejects(f.u.run(1,'7',b));assert.equal(f.counts().predict,0);}const ollama=fixture();ollama.provider.configured=()=>false;await assert.rejects(ollama.u.run(1,'7',body),e=>e.statusCode===503);const e5=fixture();e5.retriever.configured=()=>false;await assert.rejects(e5.u.run(1,'7',body),e=>e.statusCode===503);});
test('Ollama native JSON schema request and malformed/truncated/error responses',async()=>{let request;const p=new OllamaProvider({url:'http://localhost:11434',model:'local-test',fetchImpl:async(url,opts)=>{assert.equal(String(url),'http://localhost:11434/api/chat');request=JSON.parse(opts.body);assert.equal(opts.headers.Authorization,undefined);return {ok:true,text:async()=>JSON.stringify({done:true,done_reason:'stop',message:{content:'{"recommendations":[],"noRecommendationReason":"Insufficient evidence"}'}})};}});assert.equal(p.name,'OLLAMA');assert.deepEqual((await p.generate({})).recommendations,[]);assert.equal(request.stream,false);assert.equal(request.format.type,'object');for(const response of [{ok:false,status:401},{ok:true,text:async()=>'{broken'},{ok:true,text:async()=>JSON.stringify({done:true,done_reason:'length',message:{content:'{}'}})}]){p.fetchImpl=async()=>response;await assert.rejects(p.generate({}),e=>e.statusCode===502);}});

test('AI analysis config reports Ollama and E5 independently',async()=>{
 const previousUrl=process.env.OLLAMA_BASE_URL,previousModel=process.env.OLLAMA_MODEL,previousE5=process.env.E5_BASE_URL,previousClient=process.env.CF_ACCESS_CLIENT_ID,previousSecret=process.env.CF_ACCESS_CLIENT_SECRET;
 process.env.OLLAMA_BASE_URL='http://127.0.0.1:11435';process.env.OLLAMA_MODEL='qwen2.5:3b';
 process.env.E5_BASE_URL='https://e5.example.test';process.env.CF_ACCESS_CLIENT_ID='client';process.env.CF_ACCESS_CLIENT_SECRET='secret';
 const express=require('express'),{createAiRouter}=require('../src/modules/ai/ai.routes');
 const app=express(),repository={pool:{},assertHr:async actor=>assert.equal(actor,7)};
 app.use(express.json());
 app.use('/api/ai',createAiRouter({service:{},repository,policyRepository:{},authenticate:(req,_res,next)=>{req.auth={userId:7};next();}}));
 app.use((error,_req,res,_next)=>res.status(error.statusCode||500).json({message:error.message}));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 try{
  const response=await fetch(`http://127.0.0.1:${server.address().port}/api/ai/analysis-config`),body=await response.json();
  assert.equal(response.status,200);assert.equal(body.data.configured,true);assert.equal(body.data.provider,'OLLAMA+E5');assert.equal(body.data.model,'qwen2.5:3b + multilingual-e5-small');assert.deepEqual(body.data.providers.OLLAMA,{configured:true,model:'qwen2.5:3b'});assert.deepEqual(body.data.providers.E5,{configured:true,model:'multilingual-e5-small'});
  const invalid=await fetch(`http://127.0.0.1:${server.address().port}/api/ai/employees/7/analyze`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({provider:'UNKNOWN'})});assert.equal(invalid.status,400);
 }finally{
  await new Promise(resolve=>server.close(resolve));
  if(previousUrl===undefined)delete process.env.OLLAMA_BASE_URL;else process.env.OLLAMA_BASE_URL=previousUrl;
  if(previousModel===undefined)delete process.env.OLLAMA_MODEL;else process.env.OLLAMA_MODEL=previousModel;
  if(previousE5===undefined)delete process.env.E5_BASE_URL;else process.env.E5_BASE_URL=previousE5;
  if(previousClient===undefined)delete process.env.CF_ACCESS_CLIENT_ID;else process.env.CF_ACCESS_CLIENT_ID=previousClient;
  if(previousSecret===undefined)delete process.env.CF_ACCESS_CLIENT_SECRET;else process.env.CF_ACCESS_CLIENT_SECRET=previousSecret;
 }
});
test('atomic persistence: recommendations reference same prediction; errors roll back everything',async()=>{
 const {AiRepository}=require('../src/modules/ai/ai.repository');
 const {FEATURES}=require('../src/modules/ai_input/helpers/ai-input.features');
 for(const fail of [false,true]){
  const calls=[];const db={release(){},query:async(sql,args=[])=>{calls.push({sql,args});if(sql.startsWith('SELECT e.id FROM employees e'))return {rows:[{id:7}]};if(sql.startsWith('INSERT INTO prediction_results'))return {rows:[{id:9}]};if(sql.startsWith('SELECT id FROM retention_policies'))return {rows:[{id:'1'}]};if(sql.startsWith('INSERT INTO policy_recommendations')){assert.equal(args[0],9);assert.equal(args[3],'Overtime_Hours');if(fail)throw Error('insert failure');return {rows:[{id:10}]};}return {rows:[]};}};
  const repo=new AiRepository({connect:async()=>db});repo.assertHr=async()=>{};const features=Object.fromEntries(FEATURES.map(k=>[k,1]));repo.readSnapshot=async()=>({features});
  const analysis={provider:'OLLAMA',model:'test',recommendations:[{policy:{id:'1',code:'P01',name:'Support',description:'Review'},reason:'Test',evidence:[{source:'MODEL',feature:'Overtime_Hours'}]}]};
  const run=repo.save(1,{employee:{id:7},snapshotId:3,features},{score:0.2,contributions:Object.fromEntries(FEATURES.map(k=>[k,0]))},analysis);
  if(fail){await assert.rejects(run,/insert failure/);assert.equal(calls.at(-1).sql,'ROLLBACK');assert(!calls.some(c=>c.sql==='COMMIT'));}else{assert.equal((await run).predictionId,9);assert.equal(calls.at(-1).sql,'COMMIT');assert.equal(analysis.savedRecommendations[0].id,10);assert(calls.some(c=>c.sql.includes("'AI_POLICY_ANALYSIS'")));}
 }
});
test('legacy snapshot without period runs only with an explicit valid evidence period',async()=>{
 const f=fixture(),original=f.repo.readSnapshot;f.repo.readSnapshot=async()=>({...await original(),period:null});
 await assert.rejects(f.u.run(1,'7',body),e=>e.statusCode===409);assert.equal(f.counts().predict,0);
 const r=await f.u.run(1,'7',{...body,save:false,evidencePeriod:{from:'2026-11-01',to:'2026-11-19'}});assert.equal(r.policyAnalysis.selection.from,'2026-11-01');assert.equal(r.saved,false);
 const invalid=fixture();await assert.rejects(invalid.u.run(1,'7',{...body,evidencePeriod:{from:'2026-11-19',to:'2026-11-01'}}),e=>e.statusCode===400);assert.equal(invalid.counts().predict,0);
});
