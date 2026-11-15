const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const root=path.resolve(__dirname,'..');const mod=p=>require(path.join(root,p));
const v=mod('src/modules/surveys/surveys.dynamic.validation');
test('rating, configuration spoofing, all answers required and equal category weights',()=>{
 const rating={questionText:'Rate',categoryId:1,questionType:'RATING',answerConfig:v.ratingConfig()};
 assert.equal(v.question(rating).questionType,'RATING');
 for(const patch of [{answerConfig:{...v.ratingConfig(),templateCode:'FAKE'}},{isSatisfactionCore:true},{options:[]},{answerConfig:{min:0,max:10,labels:[]}}])assert.throws(()=>v.question({...rating,...patch}),{statusCode:400});
 for(const x of [null,'5',0,6,1.5,{},[4]])assert.throws(()=>v.answers({answers:[{questionId:1,answerValue:x}]},[{...rating,id:1}]),{statusCode:400});
 assert.throws(()=>v.answers({answers:[]},[{...rating,id:1}]),{statusCode:400});
 const qs=[{...rating,id:1,isSatisfactionCore:true},{...rating,id:2,isSatisfactionCore:true},{...rating,id:3,categoryId:2,isSatisfactionCore:true},{...rating,id:4}];
 assert.equal(v.score(qs,[1,1,5,5].map((x,i)=>({questionId:i+1,answerValue:x}))),3);
 assert.equal(v.score(qs,[]),null);
 assert.throws(()=>v.survey({title:'X',cycleNumber:4}),{statusCode:400});
});
test('TEMP PostgreSQL lifecycle: cycles, defaults, rating, freeze, application score, audit and history; no migration or triggers',async()=>{
 const {databasePool:p}=mod('src/config/database');const {DynamicSurveys}=mod('src/modules/surveys/surveys.dynamic');const c=await p.connect();
 try{
 await c.query(`CREATE TEMP TABLE role(id int PRIMARY KEY,name text);CREATE TEMP TABLE users(id int PRIMARY KEY,role_id int,status text,employee_id int);CREATE TEMP TABLE employees(id int PRIMARY KEY,employee_code text,full_name text,employment_status text);
 CREATE TEMP TABLE surveys(id serial PRIMARY KEY,title varchar(255),description text,start_date timestamptz,end_date timestamptz,status text DEFAULT 'DRAFT',created_by int,created_at timestamptz DEFAULT CURRENT_TIMESTAMP,updated_at timestamptz DEFAULT CURRENT_TIMESTAMP);
 CREATE TEMP TABLE survey_categories(id int PRIMARY KEY,name text,description text,cycle_number int);
 CREATE TEMP TABLE survey_questions(id serial PRIMARY KEY,question_text text,category_id int,question_type public.survey_question_type,survey_id int,answer_config jsonb,display_order int DEFAULT 0,created_at timestamptz DEFAULT CURRENT_TIMESTAMP);
 CREATE TEMP TABLE survey_responses(id serial PRIMARY KEY,survey_id int,employee_id int,submitted_at timestamptz,created_at timestamptz DEFAULT CURRENT_TIMESTAMP,UNIQUE(survey_id,employee_id));
 CREATE TEMP TABLE survey_answers(id serial PRIMARY KEY,response_id int,question_id int,answer_value jsonb,comment text,created_at timestamptz DEFAULT CURRENT_TIMESTAMP,UNIQUE(response_id,question_id));
 CREATE TEMP TABLE audit_logs(user_id int,entity_type text,entity_id int,action text,old_value jsonb,new_value jsonb);
 INSERT INTO role VALUES(1,'HR'),(2,'EMPLOYEE');INSERT INTO users VALUES(1,1,'ACTIVE',NULL),(2,2,'ACTIVE',10),(3,2,'ACTIVE',11),(4,2,'INACTIVE',12);
 INSERT INTO employees VALUES(10,'TEST10','Test10','ACTIVE'),(11,'TEST11','Test11','ACTIVE'),(12,'TEST12','Test12','ACTIVE');INSERT INTO survey_categories VALUES(1,'COMPENSATION_BENEFITS','Pay',1),(2,'WORKING_TIME','Time',2),(3,'JOB_FIT','Work',1),(9,'OTHER','Other',NULL);`);

 const s=new DynamicSurveys({connect:async()=>({query:(...a)=>c.query(...a),release(){}})});
 const body={title:'Cycle1',cycleNumber:1,categoryIds:[1,3],startDate:new Date(Date.now()-86400000).toISOString(),endDate:new Date(Date.now()+86400000).toISOString()};
 await assert.rejects(s.create(1,{...body,categoryIds:[]}),e=>e.statusCode===400);
 await assert.rejects(s.create(1,{...body,categoryIds:[1,1]}),e=>e.statusCode===400);
 await assert.rejects(s.create(1,{...body,categoryIds:[2]}),e=>e.statusCode===400);
 const subset=await s.create(1,{...body,categoryIds:[1]});assert.equal((await s.questions(c,subset.id)).length,2);
 await assert.rejects(s.question(1,subset.id,null,{questionText:'Unselected topic',questionType:'TEXT',categoryId:3}),e=>e.statusCode===400);
 await s.transition(1,subset.id); // Publishing only the selected subset is allowed.
 const combined=await s.create(1,{...body,categoryIds:[1,9],questions:[{questionText:'Custom before save',categoryId:1,questionType:'TEXT'},{questionText:'Other before save',categoryId:9,questionType:'TEXT'}]});
 const combinedQuestions=await s.questions(c,combined.id);assert.equal(combinedQuestions.length,4);assert.equal((await s.one(c,combined.id)).cycleNumber,1);
 await s.question(1,combined.id,null,{questionText:'More other',categoryId:9,questionType:'TEXT'});
 await s.transition(1,combined.id);
 await assert.rejects(s.create(1,{...body,categoryIds:[9],questions:[{questionText:'Only other',categoryId:9,questionType:'TEXT'}]}),e=>e.statusCode===400);
 await assert.rejects(s.create(1,{...body,categoryIds:[1],questions:[{questionText:'Foreign',categoryId:2,questionType:'TEXT'}]}),e=>e.statusCode===400);
 for(const cycle of [1,2,3])assert.ok((await s.categories(c,cycle)).some(cat=>cat.name==='OTHER'));
 const draft=await s.create(1,body);const id=draft.id;let qs=await s.questions(c,id);assert.equal(draft.cycleNumber,1);assert.equal((await s.list(1))[0].cycleNumber,1);assert.equal(qs.length,3);assert.ok(qs.every(q=>q.questionType==='RATING'&&q.isSatisfactionCore));
 assert.equal((await s.categories(c,1)).length,3);
 await assert.rejects(s.edit(1,id,{cycleNumber:2}),e=>e.statusCode===409);
 await assert.rejects(s.question(1,id,qs[0].id,null,true),e=>e.statusCode===409);
 const custom={questionText:'Pressure frequency',categoryId:1,questionType:'RATING',answerConfig:{min:1,max:5,labels:['Never','Rarely','Sometimes','Often','Always']}};
 await assert.rejects(s.question(1,id,null,{...custom,categoryId:2}),e=>e.statusCode===400);
 await assert.rejects(s.question(1,id,null,{...custom,answerConfig:{...custom.answerConfig,templateCode:'ERIS_PAY_V1'}}),e=>e.statusCode===400);
 const extra=await s.question(1,id,null,custom);const text=await s.question(1,id,null,{questionText:'Comment',categoryId:1,questionType:'TEXT'});
 const other=await s.create(1,{...body,cycleNumber:2,categoryIds:[2]});const foreign=(await s.questions(c,other.id))[0];
 await s.transition(1,id);qs=await s.questions(c,id);
 await assert.rejects(s.edit(1,id,{title:'Changed'}),e=>e.statusCode===409);
 await assert.rejects(s.question(1,id,extra.id,custom),e=>e.statusCode===409);
 await assert.rejects(s.submit(2,id,{answers:[{questionId:foreign.id,answerValue:4}]}),e=>e.statusCode===400);
 const answers=qs.map(q=>({questionId:q.id,answerValue:q.questionType==='TEXT'?'Need support':q.id===extra.id?5:q.categoryId===1?1:5}));
 await c.query("ALTER TABLE pg_temp.audit_logs ADD CONSTRAINT fail_submit CHECK(entity_type<>'survey_responses') NOT VALID");
 await assert.rejects(s.submit(2,id,{answers}));assert.equal((await c.query('SELECT count(*)::int n FROM pg_temp.survey_answers')).rows[0].n,0);
 await c.query('ALTER TABLE pg_temp.audit_logs DROP CONSTRAINT fail_submit');
 const result=await s.submit(2,id,{answers});assert.equal(result.satisfactionScore,3);
 const {latestSatisfaction}=mod('src/modules/surveys/surveys.satisfaction');const cutoff=(await c.query('SELECT clock_timestamp() AS now')).rows[0].now;assert.equal(await latestSatisfaction(c,10,cutoff),3);assert.equal(await latestSatisfaction(c,10,new Date(cutoff.getTime()-86400000).toISOString()),null);
 await assert.rejects(s.submit(2,id,{answers}),e=>e.statusCode===409);
 const report=await s.results(1,id);assert.equal(report.completionRate,50);assert.equal(report.categoryScores.length,2);assert.equal(report.categoryScores.find(c=>c.categoryId===1).satisfactionScore,1);assert.equal(report.categoryScores.find(c=>c.categoryId===3).satisfactionScore,5);assert.equal(report.questions.find(q=>q.id===extra.id).averageScore,5);

 await s.transition(1,id,true);await assert.rejects(s.submit(3,id,{answers}),e=>e.statusCode===409);assert.equal((await s.responses(2,id,null,true)).satisfactionScore,3);
 console.log('Public DB read-only; all lifecycle writes used TEMP tables.');
 }finally{await c.query('ROLLBACK');await c.query('DISCARD TEMP');c.release();await p.end();}
});
