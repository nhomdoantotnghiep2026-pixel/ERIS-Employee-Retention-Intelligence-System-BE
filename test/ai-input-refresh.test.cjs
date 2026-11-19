const test=require('node:test');
const assert=require('node:assert/strict');
const {ExchangeRateService}=require('../src/modules/ai/ai.exchange-rate');
const {AiService}=require('../src/modules/ai/ai.service');
const {score}=require('../src/modules/surveys/surveys.dynamic.validation');
const {periodSatisfaction}=require('../src/modules/surveys/surveys.satisfaction');
const now=()=>new Date('2026-11-18T05:00:00Z');
const data={date:'2026-11-18',base:'USD',quote:'VND',rate:25771};
const ok=async()=>({ok:true,json:async()=>data});
test('latest reference rate validates units, coalesces requests and expires cache',async()=>{
 let calls=0,time=now();
 const rates=new ExchangeRateService({clock:()=>time,fetchImpl:async()=>{calls++;return ok();}});
 const [a,b]=await Promise.all([rates.latest(),rates.latest()]);
 assert.equal(calls,1);assert.equal(a.vndPerUsd,25771);assert.equal(a.rateDate,'2026-11-18');assert.deepEqual(a,b);
 assert.equal((await rates.latest()).cached,true);
 time=new Date(time.getTime()+60001);assert.equal((await rates.latest()).cached,false);assert.equal(calls,2);
});
test('bad/stale/future/non-numeric rates and network failures never become fallback rates',async()=>{
 for(const payload of [{...data,rate:0},{...data,rate:'25771'},{...data,base:'EUR'},{...data,date:'2026-11-01'},{...data,date:'2026-11-19'},{...data,date:'2026-02-30'}]){
  const rates=new ExchangeRateService({clock:now,fetchImpl:async()=>({ok:true,json:async()=>payload})});
  await assert.rejects(rates.latest(),e=>e.statusCode===503);
 }
 let fail=false;
 const rates=new ExchangeRateService({clock:now,cacheMs:0,fetchImpl:async()=>{if(fail)throw Error('offline');return ok();}});
 await rates.latest();fail=true;await assert.rejects(rates.latest(),e=>e.statusCode===503);
 fail=false;assert.equal((await rates.latest()).rate,25771);
});
test('preview uses fetched rate and records provenance; explicit rate remains supported',async()=>{
 let fetched=0,captured;
 const row={id:1,employeeCode:'EMP001',fullName:'Demo',department:'IT',gender:'MALE',date_of_birth:'1995-01-01',hire_date:'2020-01-01',education_level:'Bachelor',current_salary:25771000,promotions:0,satisfaction:4,period_working_minutes:2400,ytd_incomplete_days:0,ytd_overtime_minutes:0,absence_days:2};
 const repository={assertHr:async()=>{},read:async()=>row,createSnapshot:async(_actor,p)=>{captured=p;return 1;},readSnapshot:async()=>captured};
 const service=new AiService({repository,client:{},clock:now,exchangeRates:{latest:async()=>{fetched++;return{...data,vndPerUsd:data.rate,rateDate:data.date,source:'Frankfurter'};}}});
 const p=await service.preview(1,1,{periodStart:'2026-11-12'});assert.equal(p.features.Monthly_Salary,1000);assert.equal(p.exchangeRate.source,'Frankfurter');assert.equal(fetched,1);
 assert.equal(p.monthlySalaryVnd,25771000);assert.equal(p.vndPerUsd,25771);assert.equal(p.fxRateDate,data.date);
 const manual=await service.preview(1,1,{periodStart:'2026-11-12',vndPerUsd:25000});
 assert.equal(manual.features.Monthly_Salary,1030.84);assert.equal(manual.vndPerUsd,25000);assert.equal(manual.fxRateDate,null);assert.equal(fetched,1);
 repository.assertHr=async()=>{throw Object.assign(Error('Forbidden'),{statusCode:403});};
 await assert.rejects(service.exchangeRate(2),e=>e.statusCode===403);assert.equal(fetched,1);
});
test('satisfaction is an unweighted mean of default answers, excluding custom ratings and text',()=>{
 const questions=[{id:1,categoryId:1},{id:2,categoryId:2},{id:3,categoryId:2},{id:4,categoryId:2}].map(q=>({...q,isSatisfactionCore:true,questionType:'RATING'}));
 questions.push({id:5,questionType:'RATING',isSatisfactionCore:false},{id:6,questionType:'TEXT',isSatisfactionCore:true});
 const answers=[5,1,1,1,5,'text'].map((value,i)=>({questionId:i+1,answerValue:value}));
 assert.equal(score(questions,answers),2);assert.equal(score(questions,answers.slice(0,2)),null);assert.equal(score([],[]),null);
});
test('AI satisfaction averages valid submitted responses within the selected period',async()=>{
 const client={async query(sql,values){
  assert.match(sql,/templateCode/);assert.match(sql,/r.submitted_at>=/);assert.match(sql,/r.submitted_at<=/);
  assert.deepEqual(values,[1,'2026-11-18T05:00:00Z','2026-11-12']);
  return {rows:[[2,1,5],[2,2,1],[1,3,5],[3,4,null]].map(([responseId,questionId,answerValue])=>({responseId,questionId,answerValue,categoryId:1,questionType:'RATING'}))};
 }};
 assert.equal(await periodSatisfaction(client,1,'2026-11-18T05:00:00Z','2026-11-12'),4);
});
test('exchange-rate HTTP endpoint requires authentication and HR',async()=>{
 const express=require('express');const {createAiRouter}=require('../src/modules/ai/ai.routes');const app=express();
 const service=new AiService({repository:{assertHr:async id=>{if(id!==1)throw Object.assign(Error('Forbidden'),{statusCode:403});}},exchangeRates:{latest:async()=>({...data,vndPerUsd:data.rate})}});
 app.use('/api/ai',createAiRouter({service,repository:{},policyRepository:{},authenticate:(req,res,next)=>{if(!req.headers.authorization)return res.sendStatus(401);req.auth={userId:Number(req.headers.authorization)};next();}}));
 app.use((error,_req,res,_next)=>res.status(error.statusCode||500).json({message:error.message}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 try{const url=`http://127.0.0.1:${server.address().port}/api/ai/exchange-rate`;assert.equal((await fetch(url)).status,401);assert.equal((await fetch(url,{headers:{Authorization:'2'}})).status,403);const r=await fetch(url,{headers:{Authorization:'1'}});assert.equal(r.status,200);assert.equal((await r.json()).data.vndPerUsd,25771);}finally{await new Promise(r=>server.close(r));}
});
