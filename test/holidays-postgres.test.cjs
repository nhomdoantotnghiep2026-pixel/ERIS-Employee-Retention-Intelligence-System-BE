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
 assert(queries[0].sql.includes("status = 'ACTIVE'"));
 assert(queries[0].sql.includes('start_date <= $1::date AND end_date >= $1::date'));
 await store.holidays();assert(queries.at(-1).sql.includes('ORDER BY start_date ASC, id ASC'));
 assert(queries.at(-1).sql.includes("status = 'ACTIVE'"));
 queries.length=0;
 const result=await store.createHoliday(input,7,'2026-11-08');assert.equal(result.data.created_by,7);
 assert.equal(queries.filter(q=>q.sql==='BEGIN').length,1);assert.equal(queries.filter(q=>q.sql==='COMMIT').length,1);
 fail=true;await assert.rejects(store.createHoliday(input,7,'2026-11-08'),/mark failure/);assert.equal(queries.at(-1).sql,'ROLLBACK');
 fail=false;overlap=true;await assert.rejects(store.createHoliday(input,7,'2026-11-08'),e=>e.statusCode===409&&e.code==='HOLIDAY_EXISTS');
 assert.equal(releases,3);
});
test('soft deletion locks holiday, preserves started holidays and is idempotent',async()=>{
 let row={status:'ACTIVE',start_date:'2026-11-09'};
 const queries=[];
 const client={release(){},async query(sql,values){
  queries.push({sql,values});
  if(sql.startsWith('SELECT')) return {rows:row?[row]:[]};
  if(sql.startsWith('UPDATE')) row.status='INACTIVE';
  return {rows:[]};
 }};
 const store=new AttendanceCalendarStore({databasePool:{connect:async()=>client}});
 await store.deleteHoliday(1,'2026-11-08');
 assert.equal(row.status,'INACTIVE');
 assert(queries.some(q=>q.sql.includes('FOR UPDATE')));
 assert.deepEqual(queries.find(q=>q.sql.startsWith('UPDATE')).values,[1]);
 await store.deleteHoliday(1,'2026-11-10');
 assert.equal(queries.filter(q=>q.sql.startsWith('UPDATE')).length,1);
 for(const date of ['2026-11-08','2026-11-07']) {
  row={status:'ACTIVE',start_date:date};
  await assert.rejects(store.deleteHoliday(1,'2026-11-08'),e=>e.statusCode===409);
  assert.equal(queries.at(-1).sql,'ROLLBACK');
 }
 row=null;
 await assert.rejects(store.deleteHoliday(99,'2026-11-08'),e=>e.statusCode===404);
});
test('delete service enforces HR, validates IDs and uses Vietnam date',async()=>{
 const {createAttendanceService}=require('../src/modules/attendance/attendance.service');
 const calls=[];
 const service=createAttendanceService({attendance:{}},{},()=>new Date('2026-11-08T17:01:00Z'),null,
  {deleteHoliday:async(...args)=>calls.push(args)});
 const hr={status:'ACTIVE',role_name:'HR'};
 await assert.rejects(service.deleteHoliday({...hr,role_name:'EMPLOYEE'},'1'),e=>e.statusCode===403);
 for(const id of ['0','-1','abc','1.5','2147483648']) await assert.rejects(service.deleteHoliday(hr,id),e=>e.statusCode===400);
 assert.equal(calls.length,0);
 await service.deleteHoliday(hr,'1');
 assert.deepEqual(calls,[[1,'2026-11-09']]);
});
test('update holiday is atomic, blocks historical/inactive records and maps overlaps',async()=>{
 let row={status:'ACTIVE',start_date:'2026-11-12'},overlap=false,markFailure=false;
 const queries=[];
 const client={release(){},async query(sql,values){
  queries.push({sql,values});
  if(sql.startsWith('SELECT status')) return {rows:row?[row]:[]};
  if(sql.startsWith('UPDATE holidays')) {
   if(overlap) throw Object.assign(new Error('overlap'),{code:'23P01'});
   return {rows:[{id:1,name:values[1],start_date:values[2],end_date:values[3],status:'ACTIVE'}]};
  }
  if(sql.includes('SELECT e.id FROM employees')&&markFailure) throw new Error('mark failed');
  return {rows:[]};
 }};
 const store=new AttendanceCalendarStore({databasePool:{connect:async()=>client}});
 const future={...input,start_date:'2026-11-09'};
 const result=await store.updateHoliday(1,future,'2026-11-08');
 assert.equal(result.data.start_date,'2026-11-09');
 assert.equal(result.affectedEmployees,0);
 assert(queries.some(q=>q.sql.includes('FOR UPDATE')));
 assert.equal(queries.at(-1).sql,'COMMIT');
 assert.deepEqual(queries.find(q=>q.sql.startsWith('UPDATE')).values,[1,'Holiday','2026-11-09','2026-11-10']);
 overlap=true;
 await assert.rejects(store.updateHoliday(1,future,'2026-11-08'),e=>e.statusCode===409&&e.code==='HOLIDAY_EXISTS');
 assert.equal(queries.at(-1).sql,'ROLLBACK');
 overlap=false;markFailure=true;
 await assert.rejects(store.updateHoliday(1,input,'2026-11-08'),/mark failed/);
 assert.equal(queries.at(-1).sql,'ROLLBACK');
 for(const invalid of [{status:'INACTIVE',start_date:'2026-11-12'},{status:'ACTIVE',start_date:'2026-11-08'},{status:'ACTIVE',start_date:'2026-11-07'}]) {
  row=invalid;
  const updates=queries.filter(q=>q.sql.startsWith('UPDATE')).length;
  await assert.rejects(store.updateHoliday(1,future,'2026-11-08'),e=>e.statusCode===409&&e.code==='HOLIDAY_NOT_EDITABLE');
  assert.equal(queries.filter(q=>q.sql.startsWith('UPDATE')).length,updates);
 }
 row=null;
 await assert.rejects(store.updateHoliday(99,future,'2026-11-08'),e=>e.statusCode===404);
});
test('update service validates HR, ID and complete body before writing',async()=>{
 const {createAttendanceService}=require('../src/modules/attendance/attendance.service');
 const calls=[],expected={data:{id:1},affectedEmployees:0};
 const service=createAttendanceService({attendance:{}},{},()=>now,null,
  {updateHoliday:async(...args)=>{calls.push(args);return expected;}});
 const hr={status:'ACTIVE',role_name:'HR'};
 await assert.rejects(service.updateHoliday({...hr,role_name:'EMPLOYEE'},'1',input),e=>e.statusCode===403);
 for(const id of ['0','-1','abc','1.5','2147483648']) await assert.rejects(service.updateHoliday(hr,id,input),e=>e.statusCode===400);
 for(const body of [{},{...input,status:'ACTIVE'},{...input,end_date:'2026-11-07'}]) await assert.rejects(service.updateHoliday(hr,'1',body),e=>e.statusCode===400);
 assert.equal(calls.length,0);
 assert.equal(await service.updateHoliday(hr,'1',input),expected);
 assert.deepEqual(calls,[[1,input,'2026-11-08']]);
});
