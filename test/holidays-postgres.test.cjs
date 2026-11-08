const test = require('node:test');
const assert = require('node:assert/strict');
const { AttendanceCalendarStore, validateHoliday } = require('../src/modules/attendance/attendance-calendar');
const now = new Date('2026-11-08T03:00:00Z');
const input = {name:'Holiday',start_date:'2026-11-08',end_date:'2026-11-10'};
test('holiday range validation',()=>{
 assert.deepEqual(validateHoliday(input,now),input);
 for(const body of [null,[],{}, {...input,date:'2026-11-08'},{...input,created_by:5},{...input,end_date:null},{...input,end_date:'2026-11-07'},{...input,start_date:'2026-11-07'},{...input,start_date:'2026-02-30'},{...input,name:' '},{...input,name:'a'.repeat(151)}]) assert.throws(()=>validateHoliday(body,now),e=>e.statusCode===400);
});
test('PostgreSQL lookup, creation, overlap and atomic rollback',async()=>{
 const queries=[];let fail=false,overlap=false,releases=0;
 const row={id:1,...input,created_by:7};
 const client={release(){releases++},async query(sql,values){
  queries.push({sql,values});
  if(sql.startsWith('INSERT INTO holidays')){if(overlap)throw Object.assign(new Error('overlap'),{code:'23P01'});return {rows:[row]}}
  if(sql.includes('SELECT e.id FROM employees')){if(fail)throw new Error('mark failure');return {rows:[]}}
  return {rows:[]};
 }};
 const store=new AttendanceCalendarStore({databasePool:{connect:async()=>client,query:async(sql,values)=>{queries.push({sql,values});return {rows:[row]}}}});
 assert.equal((await store.holiday('2026-11-09')).id,1);
 assert(queries[0].sql.includes('start_date <= $1::date AND end_date >= $1::date'));
 await store.holidays();assert(queries.at(-1).sql.includes('ORDER BY start_date ASC, id ASC'));
 queries.length=0;
 const result=await store.createHoliday(input,7,'2026-11-08');assert.equal(result.data.created_by,7);
 assert.equal(queries.filter(q=>q.sql==='BEGIN').length,1);assert.equal(queries.filter(q=>q.sql==='COMMIT').length,1);
 fail=true;await assert.rejects(store.createHoliday(input,7,'2026-11-08'),/mark failure/);assert.equal(queries.at(-1).sql,'ROLLBACK');
 fail=false;overlap=true;await assert.rejects(store.createHoliday(input,7,'2026-11-08'),e=>e.statusCode===409&&e.code==='HOLIDAY_EXISTS');
 assert.equal(releases,3);
});
