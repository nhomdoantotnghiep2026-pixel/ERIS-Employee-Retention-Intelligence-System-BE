const test=require('node:test');
const assert=require('node:assert/strict');
const {AiRepository}=require('../src/modules/ai/ai.repository');
const {build}=require('../src/modules/ai/ai.features');

test('repository assembles current schedule and YTD sources in one consistent transaction',async()=>{
 const queries=[];let released=false;
 const client={release(){released=true;},async query(sql,values){
  queries.push({sql,values});
  if(sql.includes('SELECT e.id,e.employee_code')) return {rows:[{id:7,hire_date:'2026-03-01'}]};
  if(sql.includes('AS scheduled_weekly_hours')) return {rows:[{scheduled_weekly_hours:'40.00'}]};
  if(sql.includes('AS ytd_incomplete_days')) return {rows:[{ytd_incomplete_days:'0',ytd_overtime_minutes:'0',absence_days:'0'}]};
  return {rows:[]};
 }};
 const repository=new AiRepository({connect:async()=>client});
 const row=await repository.read(7,{periodStart:'2025-01-01',periodEnd:'2025-01-31'},'2026-11-10','2026-11-10T05:00:00Z');
 assert.equal(queries[0].sql,'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
 assert.equal(queries.at(-1).sql,'COMMIT');assert.equal(released,true);
 assert.deepEqual(queries.find(q=>q.sql.includes('AS satisfaction')).values,[7,'2026-11-10','2026-11-10T05:00:00Z']);
 assert.deepEqual(queries.find(q=>q.sql.includes('AS ytd_incomplete_days')).values,[7,'2026-11-10','2026-03-01','2026-11-10T05:00:00Z']);
 const f=build(row,{supplementalFeatures:{}},'2026-11-10').features;
 assert.equal(f.Work_Hours_Per_Week,40);assert.equal(f.Overtime_Hours,0);assert.equal(f.Sick_Days,0);
});

test('missing schedule and survey remain missing rather than becoming zero',()=>{
 const result=build({hire_date:'2026-11-10',ytd_incomplete_days:'0',ytd_overtime_minutes:'0',absence_days:'0',satisfaction:null},{supplementalFeatures:{}},'2026-11-10');
 assert.equal(result.features.Years_At_Company,0);
 assert(result.missingFeatures.includes('Work_Hours_Per_Week'));
 assert(result.missingFeatures.includes('Employee_Satisfaction_Score'));
});

test('source read failure rolls back and releases client',async()=>{
 const queries=[];let released=false;
 const client={release(){released=true;},async query(sql){queries.push(sql);if(sql.startsWith('SELECT'))throw new Error('source unavailable');return {rows:[]};}};
 await assert.rejects(new AiRepository({connect:async()=>client}).read(1,{},'2026-11-10'),/source unavailable/);
 assert.equal(queries.at(-1),'ROLLBACK');assert.equal(released,true);
});
