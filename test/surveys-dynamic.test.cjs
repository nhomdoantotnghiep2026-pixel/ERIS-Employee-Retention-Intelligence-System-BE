const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const root=path.resolve(__dirname,'..'),mod=p=>require(path.join(root,p));
const v=mod('src/modules/surveys/surveys.dynamic.validation'),catalog=mod('src/modules/surveys/surveys.satisfaction-templates');
test('participant HTTP routes validate IDs, require auth, preserve scope and return private responses',async()=>{
const express=mod('node_modules/express'),{AppError}=mod('src/common/errors/app-error'),{createDynamicSurveysRouter}=mod('src/modules/surveys/surveys.dynamic'),{errorHandler}=mod('src/common/middleware/error-handler');const calls=[];
const app=express();app.use(express.json());app.use('/api/surveys',createDynamicSurveysRouter({authenticate:(req,res,next)=>{if(!req.headers.authorization)return next(new AppError(401,'Login required'));req.auth={userId:req.headers.authorization==='Bearer employee'?2:1};next();},service:{participants:async(actor,survey,employee=null)=>{if(actor!==1)throw new AppError(403,'HR required');calls.push([actor,survey,employee]);return employee?{employeeId:employee,surveyId:survey,answers:[{questionText:'Question',displayAnswer:'4/5'}]}:[{employeeId:10,responseId:100,answerCount:4}];}}}));app.use(errorHandler);const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));try{const url='http://127.0.0.1:'+server.address().port+'/api/surveys/7/participants';assert.equal((await fetch(url)).status,401);assert.equal((await fetch(url,{headers:{Authorization:'Bearer employee'}})).status,403);const list=await fetch(url,{headers:{Authorization:'Bearer hr'}});assert.equal(list.status,200);assert.match(list.headers.get('cache-control'),/no-store/);assert.deepEqual((await list.json()).data,[{employeeId:10,responseId:100,answerCount:4}]);const detail=await fetch(url+'/10',{headers:{Authorization:'Bearer hr'}});assert.equal(detail.status,200);assert.equal((await detail.json()).data.employeeId,10);assert.equal((await fetch(url+'/bad',{headers:{Authorization:'Bearer hr'}})).status,400);assert.equal((await fetch(url+'?unexpected=1',{headers:{Authorization:'Bearer hr'}})).status,400);assert.deepEqual(calls,[[1,7,null],[1,7,10]]);}finally{await new Promise(resolve=>server.close(resolve));}
});
test('fixed catalog: 4 scoring defaults and 10 distinct bank questions per category, OTHER included',()=>{
const names=['COMPENSATION_BENEFITS','WORKING_TIME','WORK_ENVIRONMENT','CAREER_DEVELOPMENT','MANAGEMENT','EMPLOYEE_ENGAGEMENT','WORK_LIFE_BALANCE','COMMUNICATION_CULTURE','JOB_FIT','OTHER'];
for(const [i,name] of names.entries()){const c={id:i+1,name},defaults=catalog.templates(c),bank=catalog.bank(c);assert.equal(defaults.length,4);assert.equal(bank.length,10);const all=[...defaults,...bank].map(q=>q.questionText);assert.equal(new Set(all).size,14);for(const q of bank)v.question({questionText:q.questionText,categoryId:q.categoryId,questionType:q.questionType,answerConfig:q.answerConfig});}
const body={title:'Flexible',categoryIds:[1]};assert.deepEqual(v.survey(body).categoryIds,[1]);assert.throws(()=>v.survey({...body,cycleNumber:1}),e=>e.statusCode===400);
for(const value of [null,'5',0,6,1.5])assert.throws(()=>v.answers({answers:[{questionId:1,answerValue:value}]},[{id:1,questionType:'RATING'}]),e=>e.statusCode===400);
assert.throws(()=>v.question({questionText:'Fake',categoryId:1,questionType:'RATING',answerConfig:{...v.ratingConfig(),templateCode:'FAKE'}}),e=>e.statusCode===400);
});
test('TEMP lifecycle without cycle columns: mixed categories, bank/custom, OTHER-only, score, freeze and history',async()=>{
const {databasePool:p}=mod('src/config/database'),{DynamicSurveys}=mod('src/modules/surveys/surveys.dynamic');const c=await p.connect();try{
 await c.query(`CREATE TEMP TABLE role(id int PRIMARY KEY,name text);CREATE TEMP TABLE users(id int PRIMARY KEY,role_id int,status text,employee_id int);CREATE TEMP TABLE employees(id int PRIMARY KEY,employee_code text,full_name text,employment_status text);
 CREATE TEMP TABLE surveys(id serial PRIMARY KEY,title varchar(255),description text,start_date timestamptz,end_date timestamptz,status text DEFAULT 'DRAFT',created_by int,created_at timestamptz DEFAULT CURRENT_TIMESTAMP,updated_at timestamptz DEFAULT CURRENT_TIMESTAMP);
 CREATE TEMP TABLE survey_categories(id int PRIMARY KEY,name text,description text);
 CREATE TEMP TABLE survey_questions(id serial PRIMARY KEY,question_text text,category_id int,question_type public.survey_question_type,survey_id int,answer_config jsonb,display_order int DEFAULT 0,created_at timestamptz DEFAULT CURRENT_TIMESTAMP);
 CREATE TEMP TABLE survey_responses(id serial PRIMARY KEY,survey_id int,employee_id int,submitted_at timestamptz,created_at timestamptz DEFAULT CURRENT_TIMESTAMP,UNIQUE(survey_id,employee_id));
 CREATE TEMP TABLE survey_answers(id serial PRIMARY KEY,response_id int,question_id int,answer_value jsonb,comment text,created_at timestamptz DEFAULT CURRENT_TIMESTAMP,UNIQUE(response_id,question_id));
 CREATE TEMP TABLE audit_logs(user_id int,entity_type text,entity_id int,action text,old_value jsonb,new_value jsonb);
 INSERT INTO role VALUES(1,'HR'),(2,'EMPLOYEE');INSERT INTO users VALUES(1,1,'ACTIVE',NULL),(2,2,'ACTIVE',10),(3,2,'ACTIVE',11),(4,2,'INACTIVE',12);
 INSERT INTO employees VALUES(10,'TEST10','Test10','ACTIVE'),(11,'TEST11','Test11','ACTIVE'),(12,'TEST12','Test12','ACTIVE');INSERT INTO survey_categories VALUES(1,'COMPENSATION_BENEFITS','Pay'),(2,'WORKING_TIME','Time'),(3,'JOB_FIT','Work'),(9,'OTHER','Other');`);


const s=new DynamicSurveys({connect:async()=>({query:(...a)=>c.query(...a),release(){}})});
const window={startDate:new Date(Date.now()-86400000).toISOString(),endDate:new Date(Date.now()+86400000).toISOString()};
const {seedCatalog}=mod('src/modules/surveys/surveys.catalog');
await c.query('BEGIN');const firstSeed=await seedCatalog(c,{apply:true,expectedCategoryCount:4});assert.equal(firstSeed.inserted,56);assert.equal(firstSeed.skipped,0);await c.query('COMMIT');
await c.query('BEGIN');const secondSeed=await seedCatalog(c,{apply:true,expectedCategoryCount:4});assert.equal(secondSeed.inserted,0);assert.equal(secondSeed.skipped,56);await c.query('COMMIT');
const beforeUpdate=await s.categories(c);const source=beforeUpdate[0].questionBank[1];assert.ok(source.catalogQuestionId);
await c.query('UPDATE survey_questions SET question_text=$2 WHERE id=$1',[source.catalogQuestionId,'Stored bank wording from database']);assert.equal((await s.categories(c))[0].questionBank[1].questionText,'Stored bank wording from database');
await c.query('BEGIN');await assert.rejects(seedCatalog(c,{apply:true,expectedCategoryCount:4}),/no overwrite/);await c.query('ROLLBACK');
await c.query('UPDATE survey_questions SET question_text=$2 WHERE id=$1',[source.catalogQuestionId,source.questionText]);
const cats=await s.categories(c);assert.equal(cats.length,4);assert.ok(cats.every(c=>c.defaultQuestions.length===4&&c.questionBank.length===10));
const selectedBank=cats[0].questionBank[0];const bankRequest={questionText:selectedBank.questionText,categoryId:1,questionType:selectedBank.questionType,answerConfig:selectedBank.answerConfig};
const body={title:'Flexible',categoryIds:[1,2,9],questions:[bankRequest,{questionText:'My own question',categoryId:9,questionType:'TEXT'}],...window};
await assert.rejects(s.create(1,{...body,categoryIds:[999]}),e=>e.statusCode===400);
await assert.rejects(s.create(1,{...body,categoryIds:[1,1]}),e=>e.statusCode===400);
await assert.rejects(s.create(1,{...body,categoryIds:[1]}),e=>e.statusCode===400);
await assert.rejects(s.create(1,{...body,questions:[...body.questions,bankRequest]}),e=>e.statusCode===400);
const survey=await s.create(1,body),id=survey.id;assert.equal(survey.cycleNumber,undefined);assert.equal((await s.list(1)).length,1);let qs=await s.questions(c,id);assert.equal(qs.length,14);assert.equal(qs.filter(q=>q.isSatisfactionCore).length,12);
await assert.rejects(s.question(1,id,qs[0].id,null,true),e=>e.statusCode===409);
await assert.rejects(s.question(1,id,null,{questionText:'Unselected',categoryId:3,questionType:'TEXT'}),e=>e.statusCode===400);
const custom=await s.question(1,id,null,{questionText:'Frequency',categoryId:2,questionType:'RATING',answerConfig:{min:1,max:5,labels:['Never','Rarely','Sometimes','Often','Always']}});
const other=await s.create(1,{title:'Only OTHER',categoryIds:[9],...window});assert.equal((await s.questions(c,other.id)).length,4);await s.transition(1,other.id);
await s.transition(1,id);qs=await s.questions(c,id);
await assert.rejects(s.question(1,id,custom.id,null,true),e=>e.statusCode===409);await assert.rejects(s.edit(1,id,{title:'Changed'}),e=>e.statusCode===409);
await assert.rejects(s.submit(2,id,{answers:[]}),e=>e.statusCode===400);
const answers=qs.map(q=>({questionId:q.id,answerValue:q.questionType==='TEXT'?'Need support':q.questionType==='MULTIPLE_CHOICE'?{selectedCodes:[q.answerConfig.options[0].code]}:q.isSatisfactionCore?(q.categoryId===1?1:q.categoryId===2?5:3):5}));
await c.query("ALTER TABLE pg_temp.audit_logs ADD CONSTRAINT fail_submit CHECK(entity_type<>'survey_responses') NOT VALID");await assert.rejects(s.submit(2,id,{answers}));assert.equal((await c.query('SELECT count(*)::int n FROM pg_temp.survey_answers')).rows[0].n,0);await c.query('ALTER TABLE pg_temp.audit_logs DROP CONSTRAINT fail_submit');
const result=await s.submit(2,id,{answers});assert.equal(result.satisfactionScore,3);
const participants=await s.participants(1,id);assert.equal(participants.length,1);assert.equal(participants[0].employeeId,10);assert.equal(participants[0].answerCount,qs.length);assert.equal(participants[0].answers,undefined);
const employeeResponse=await s.participants(1,id,10);assert.equal(employeeResponse.surveyId,id);assert.equal(employeeResponse.answers.length,qs.length);assert.ok(employeeResponse.answers.every(a=>a.questionText&&a.questionType&&a.categoryName));
const choice=employeeResponse.answers.find(a=>a.questionType==='MULTIPLE_CHOICE');assert.deepEqual(choice.selectedOptions,[{code:selectedBank.answerConfig.options[0].code,label:selectedBank.answerConfig.options[0].label}]);assert.equal(choice.displayAnswer,selectedBank.answerConfig.options[0].label);
const rating=employeeResponse.answers.find(a=>a.isSatisfactionCore);assert.ok(rating.displayAnswer.startsWith('1/5'));assert.equal(employeeResponse.answers.find(a=>a.questionType==='TEXT').displayAnswer,'Need support');
const detail=await s.detail(1,id);assert.equal(detail.participantCount,1);assert.equal(detail.invitedCount,2);
await assert.rejects(s.participants(1,id,11),e=>e.statusCode===404);await assert.rejects(s.participants(1,other.id,10),e=>e.statusCode===404);await assert.rejects(s.participants(2,id),e=>e.statusCode===403);await assert.rejects(s.participants(1,99999),e=>e.statusCode===404);
assert.equal((await s.responses(1,id,result.responseId)).answers.length,qs.length);
await assert.rejects(s.submit(2,id,{answers}),e=>e.statusCode===409);
const {latestSatisfaction}=mod('src/modules/surveys/surveys.satisfaction'),cutoff=(await c.query('SELECT clock_timestamp() AS now')).rows[0].now;assert.equal(await latestSatisfaction(c,10,cutoff),3);
const report=await s.results(1,id);assert.equal(report.categoryScores.length,3);assert.equal(report.categoryScores.find(c=>c.categoryId===9).satisfactionScore,3);assert.equal(report.questions.find(q=>q.id===custom.id).averageScore,5);assert.equal(report.completionRate,50);
await s.transition(1,id,true);await assert.rejects(s.submit(3,id,{answers}),e=>e.statusCode===409);assert.equal((await s.responses(2,id,null,true)).satisfactionScore,3);
// Previously stored V1 snapshots remain publishable when the current catalog is V2.
const legacy=(await c.query("INSERT INTO surveys(title,start_date,end_date,status) VALUES('V1',CURRENT_TIMESTAMP-INTERVAL '1 day',CURRENT_TIMESTAMP+INTERVAL '1 day','DRAFT') RETURNING id")).rows[0];
await c.query("INSERT INTO survey_questions(survey_id,question_text,category_id,question_type,answer_config) VALUES($1,'Original V1 wording',1,'RATING',$2)",[legacy.id,{...v.ratingConfig(),templateCode:'ERIS_PAY_V1'}]);await s.transition(1,legacy.id);
console.log('PASS TEMP only: no schema migration and no public business writes.');
}finally{await c.query('ROLLBACK');await c.query('DISCARD TEMP');c.release();await p.end();}});
