const test=require('node:test');
const assert=require('node:assert/strict');
const {AiInputRepository}=require('../src/modules/ai_input/ai-input.repository');
const {build}=require('../src/modules/ai_input/ai-input.features');

test('repository assembles period attendance and YTD sources in one consistent transaction',async()=>{
 const queries=[];let released=false;
 const client={release(){released=true;},async query(sql,values){
  queries.push({sql,values});
  if(sql.includes('SELECT e.id,e.employee_code')) return {rows:[{id:7,hire_date:'2026-03-01'}]};
  if(sql.includes('AS period_working_minutes')) return {rows:[{period_working_minutes:'2400'}]};
  if(sql.includes('AS ytd_overtime_minutes')) return {rows:[{ytd_overtime_minutes:'0',absence_days:'0'}]};
  return {rows:[]};
 }};
 const repository=new AiInputRepository({connect:async()=>client});
 const period={periodStart:'2026-11-04',periodEnd:'2026-11-10'};
 const row=await repository.read(7,period,'2026-11-10','2026-11-10T05:00:00Z');
 assert.equal(queries[0].sql,'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
 assert.equal(queries.at(-1).sql,'COMMIT');assert.equal(released,true);
 assert.deepEqual(queries.find(q=>q.sql.includes('q.question_type=')).values,[7,'2026-11-10T05:00:00Z','2026-11-04']);
 const attendance=queries.find(q=>q.sql.includes('AS period_working_minutes'));
 assert.match(attendance.sql,/complete IS NOT TRUE/);
 assert.match(attendance.sql,/l.record_status='ACTIVE'/);
 assert.deepEqual(attendance.values,[7,'2026-11-10','2026-11-04','2026-11-10T05:00:00Z','2026-03-01']);
 const statsSql=queries.find(q=>q.sql.includes('AS ytd_overtime_minutes')).sql;
 assert.match(statsSql,/att.attendance_status='ON_LEAVE'/);assert(!statsSql.includes('holidays'));assert(!statsSql.includes("'ON_LEAVE','ABSENT'"));
 assert.deepEqual(queries.find(q=>q.sql.includes('AS ytd_overtime_minutes')).values,[7,'2026-11-10','2026-11-10T05:00:00Z']);
 const f=build(row,{...period,supplementalFeatures:{}},'2026-11-10').features;
 assert.equal(f.Work_Hours_Per_Week,40);assert.equal(f.Overtime_Hours,0);assert.equal(f.Sick_Days,0);
});

test('missing period attendance and survey remain missing rather than becoming zero',()=>{
 const result=build({hire_date:'2026-11-10',ytd_overtime_minutes:null,absence_days:null,satisfaction:null},{supplementalFeatures:{}},'2026-11-10');
 assert.equal(result.features.Years_At_Company,0);
 assert(result.missingFeatures.includes('Work_Hours_Per_Week'));
 assert(result.missingFeatures.includes('Employee_Satisfaction_Score'));
 assert(result.missingFeatures.includes('Overtime_Hours'));
});

test('source read failure rolls back and releases client',async()=>{
 const queries=[];let released=false;
 const client={release(){released=true;},async query(sql){queries.push(sql);if(sql.startsWith('SELECT'))throw new Error('source unavailable');return {rows:[]};}};
 await assert.rejects(new AiInputRepository({connect:async()=>client}).read(1,{},'2026-11-10'),/source unavailable/);
 assert.equal(queries.at(-1),'ROLLBACK');assert.equal(released,true);
});
