const test=require('node:test'),assert=require('node:assert/strict');
const {templates,bank}=require('../src/modules/surveys/surveys.satisfaction-templates');
const {ratingConfig,score}=require('../src/modules/surveys/surveys.dynamic.validation');
const names=['COMPENSATION_BENEFITS','WORKING_TIME','WORK_ENVIRONMENT','CAREER_DEVELOPMENT','MANAGEMENT','EMPLOYEE_ENGAGEMENT','WORK_LIFE_BALANCE','COMMUNICATION_CULTURE','JOB_FIT','OTHER'];

test('each topic has four focused satisfaction prompts with stable codes and rating scale',()=>{
 const all=[];
 names.forEach((name,index)=>{
  const category={id:index+1,name},items=templates(category);
  assert.equal(items.length,4);assert.equal(bank(category).length,10);
  items.forEach((q,i)=>{
   assert.equal(q.templateCode,`ERIS_${name}_${i+1}_V2`);assert.equal(q.categoryId,category.id);
   assert.equal(q.questionType,'RATING');assert.deepEqual(q.answerConfig,ratingConfig());
   assert.match(q.questionText,/hài lòng/iu);assert.doesNotMatch(q.questionText,/nhìn chung/iu);assert.ok(q.questionText.endsWith('?'));
   all.push(q.questionText);
  });
 });
 assert.equal(new Set(all).size,40);
});

test('wording changes do not alter how default responses produce satisfaction scores',()=>{
 const questions=templates({id:1,name:'COMPENSATION_BENEFITS'}).map((q,i)=>({...q,id:i+1,isSatisfactionCore:true}));
 const answers=[1,3,4,5].map((answerValue,i)=>({questionId:i+1,answerValue}));
 assert.equal(score(questions,answers),3.25);
 assert.equal(score(questions,answers.map(a=>({...a,answerValue:5}))),5);
 assert.equal(score(questions,answers.slice(0,3)),null);
});
