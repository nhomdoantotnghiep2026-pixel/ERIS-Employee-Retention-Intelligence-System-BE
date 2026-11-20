const {test}=require('node:test');const assert=require('node:assert/strict');
const {UnifiedAnalysis,OllamaProvider}=require('../src/modules/ai/ai-unified.service');
function fixture(){
 const preview={ready:true,snapshotId:3,capturedAt:'2026-11-20T00:00:00Z',employee:{id:7},period:{start:'2026-11-01',end:'2026-11-19'},features:{Overtime_Hours:20}};
 const policy={id:'1',code:'P01',name:'Support',description:'Review workload'};
 const context={policies:[policy],evidence:[{id:'SURVEY:1:2',source:'SURVEY'},{id:'ATTENDANCE:1',source:'ATTENDANCE'}]};let predict=0,save=0,call=0,contexts=0;const settings={};
 const repo={pool:{query:async()=>({rows:[{survey_id:1}]})},assertHr:async()=>{},readSnapshot:async()=>preview,save:async(a,p,m,analysis)=>{save++;assert.equal(analysis.recommendations.length,1);return {predictionId:8};}};
 const service={predict:async(a,e,b)=>{predict++;assert.equal(b.save,false);return {preview,model:{score:0.2,contributions:{Overtime_Hours:0.1}}};}};
 const provider={model:'test-local',configured:()=>true,generate:async c=>{call++;assert.equal(c.model.enabled,true);assert(c.evidence.some(e=>e.id==='MODEL:Overtime_Hours'));if(settings.fail)throw Error('offline');return {recommendations:[{policyId:settings.bad?'999':'1',reason:'Review evidence',evidenceIds:['SURVEY:1:2','MODEL:Overtime_Hours'],hrVerification:'Verify workload'}],noRecommendationReason:null};}};
 const agent={context:async()=>({context,fingerprint:++contexts>1&&settings.stale?'changed':'same'})};
 return {u:new UnifiedAnalysis(service,repo,{agent,provider}),settings,repo,provider,counts:()=>({predict,save,call})};
}
const body={snapshotId:3,save:true,confirmExternalData:true};
test('one prediction and one agent call combine all sources; save is last',async()=>{const f=fixture();const r=await f.u.run(1,'7',body);assert.equal(r.saved,true);assert.equal(r.predictionId,8);assert.equal(r.policyAnalysis.autoApplied,false);assert.deepEqual(f.counts(),{predict:1,save:1,call:1});});
test('preview never writes; invalid output, source changes and provider errors never save',async()=>{const preview=fixture();assert.equal((await preview.u.run(1,'7',{...body,save:false})).saved,false);assert.equal(preview.counts().save,0);for(const key of ['bad','stale','fail']){const f=fixture();f.settings[key]=true;await assert.rejects(f.u.run(1,'7',body));assert.equal(f.counts().save,0);assert.equal(f.u.busy.size,0);}});
test('reject consent/unknown fields/missing config before prediction; HR remains required',async()=>{for(const b of [{...body,confirmExternalData:false},{...body,extra:1},{...body,snapshotId:0}]){const f=fixture();await assert.rejects(f.u.run(1,'7',b));assert.equal(f.counts().predict,0);}const f=fixture();f.provider.configured=()=>false;await assert.rejects(f.u.run(1,'7',body),e=>e.statusCode===503);});
test('Ollama native JSON schema request and malformed/truncated/error responses',async()=>{let request;const p=new OllamaProvider({url:'http://localhost:11434',model:'local-test',fetchImpl:async(url,opts)=>{assert.equal(String(url),'http://localhost:11434/api/chat');request=JSON.parse(opts.body);assert.equal(opts.headers.Authorization,undefined);return {ok:true,text:async()=>JSON.stringify({done:true,done_reason:'stop',message:{content:'{"recommendations":[],"noRecommendationReason":"Insufficient evidence"}'}})};}});assert.deepEqual((await p.generate({})).recommendations,[]);assert.equal(request.stream,false);assert.equal(request.format.type,'object');for(const response of [{ok:false,status:401},{ok:true,text:async()=>'{broken'},{ok:true,text:async()=>JSON.stringify({done:true,done_reason:'length',message:{content:'{}'}})}]){p.fetchImpl=async()=>response;await assert.rejects(p.generate({}),e=>e.statusCode===502);}});
test('atomic persistence: recommendations reference same prediction; errors roll back everything',async()=>{
 const {AiRepository}=require('../src/modules/ai/ai.repository');
 const {FEATURES}=require('../src/modules/ai_input/ai-input.features');
 for(const fail of [false,true]){
  const calls=[];const db={release(){},query:async(sql,args=[])=>{calls.push({sql,args});if(sql.startsWith('SELECT e.id,u.id'))return {rows:[{id:7}]};if(sql.startsWith('INSERT INTO prediction_results'))return {rows:[{id:9}]};if(sql.startsWith('SELECT id FROM retention_policies'))return {rows:[{id:'1'}]};if(sql.startsWith('INSERT INTO policy_recommendations')){assert.equal(args[0],9);assert.equal(args[3],'Overtime_Hours');if(fail)throw Error('insert failure');return {rows:[{id:10}]};}return {rows:[]};}};
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
