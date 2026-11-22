const {test}=require('node:test'),assert=require('node:assert/strict');
const {validateCreateScheduleInput,prepareScheduleUpdate}=require('../src/modules/work-schedules/work-schedules.validation');
const {WorkSchedulesRepository}=require('../src/modules/work-schedules/work-schedules.repository');
const {WorkSchedulesService}=require('../src/modules/work-schedules/work-schedules.service');
const {createWorkSchedulesRouter}=require('../src/modules/work-schedules/work-schedules.routes');
const {errorHandler}=require('../src/common/middleware/error-handler');
const input=()=>({name:'Mid',shift_type:'mid',start_time:'11:00',end_time:'20:00',break_start:'15:00',break_end:'16:00',working_days:[1,2,3,4,5]});
function fixture(){
 const state={rows:[],audit:[],queries:[],failAudit:false,transactionHr:true};let before;
 const db={release(){},async query(sql,args=[]){
  state.queries.push({sql,args});assert(!/CREATE TABLE|ALTER TABLE|CREATE TEMP/.test(sql));
  if(sql==='BEGIN'){before=structuredClone({rows:state.rows,audit:state.audit});return {rows:[]};}
  if(sql==='ROLLBACK'){state.rows=before.rows;state.audit=before.audit;return {rows:[]};}
  if(sql.startsWith('SELECT r.name'))return {rows:args[0]===1?[{role:'HR',status:'ACTIVE'}]:args[0]===2?[{role:'EMPLOYEE',status:'ACTIVE'}]:args[0]===3?[{role:'HR',status:'INACTIVE'}]:[{role:'ADMIN',status:'ACTIVE'}]};
  if(sql.includes('SELECT u.id FROM users'))return {rows:args[0]===1&&state.transactionHr?[{id:1}]:[]};
  if(sql.includes('upper(btrim(shift_type))'))return {rows:state.rows.filter(r=>r.shift_type?.trim().toUpperCase()===args[0]&&(args[1]===null||r.id!==args[1]))};
  if(sql.includes('FROM work_schedules WHERE id=$1'))return {rows:state.rows.filter(r=>r.id===args[0])};
  if(sql.includes('SELECT EXISTS'))return {rows:[{assigned:false}]};
  if(sql.includes('FROM pg_attribute'))return {rows:[{requires_break:false}]};
  if(sql.startsWith('INSERT INTO work_schedules')){const keys=['name','shift_type','start_time','end_time','break_start','break_end','working_days','status'],row={id:state.rows.length+1,...Object.fromEntries(keys.map((k,i)=>[k,k==='attendance_policy'?JSON.parse(args[i]):args[i]]))};state.rows.push(row);return {rows:[row]};}
  if(sql.startsWith('UPDATE work_schedules SET')){const row=state.rows.find(r=>r.id===args.at(-1));sql.split(' SET ')[1].split(' WHERE ')[0].split(',').forEach((part,i)=>row[part.split('=')[0]]=args[i]);return {rows:[{...row}]};}
  if(sql.startsWith('INSERT INTO audit_logs')){if(state.failAudit)throw Error('audit failed');state.audit.push(args);}
  return {rows:[]};
 }};
 const repo=new WorkSchedulesRepository({...db,connect:async()=>db});return {state,repo,service:new WorkSchedulesService(repo)};
}
test('same-day create: start is earliest, end is latest and both break endpoints are strictly inside',()=>{
 assert.equal(validateCreateScheduleInput(input()).shift_type,'MID');
 for(const times of [{start_time:'20:00',end_time:'11:00'},{start_time:'11:00',end_time:'11:00'},{break_start:'16:00',break_end:'15:00'},{break_start:'15:00',break_end:'15:00'},{break_start:'10:59'},{break_start:'11:00'},{break_end:'20:00'},{break_end:'21:00'},{start_time:'22:00',end_time:'06:00',break_start:'02:00',break_end:'03:00'},{start_time:'24:00'},{end_time:'20:60'},{break_start:null},{break_end:null}])assert.throws(()=>validateCreateScheduleInput({...input(),...times}),e=>e.statusCode===400);
 const {break_start,break_end,...noBreak}=input();const result=validateCreateScheduleInput(noBreak);assert.equal(result.break_start,null);assert.equal(result.break_end,null);
});
test('all case variants, trimmed and full-width input normalize; missing or malformed shift_type rejected',()=>{
 for(const value of ['mid','MID','MiD',' mid ','ｍｉｄ'])assert.equal(validateCreateScheduleInput({...input(),shift_type:value}).shift_type,'MID');
 for(const value of [undefined,null,'',' ',1,'a'.repeat(51),'mid shift','mid;drop','_MID'])assert.throws(()=>validateCreateScheduleInput({...input(),shift_type:value}),e=>e.statusCode===400);
});
test('existing day/status/unknown-field validation is retained',()=>{for(const patch of [{working_days:[]},{working_days:[1,1]},{working_days:[0]},{status:'PENDING'},{created_by:1},{effective_from:'2026-11-19'}])assert.throws(()=>validateCreateScheduleInput({...input(),...patch}),e=>e.statusCode===400);});
test('only HR ACTIVE creates, rechecks role in transaction and records audit',async()=>{
 const f=fixture();for(const id of [2,3,4])await assert.rejects(f.service.create(id,input()),e=>e.statusCode===403);assert.equal(f.state.rows.length,0);
 const row=await f.service.create(1,input());assert.equal(row.shift_type,'MID');assert.equal(f.state.audit.length,1);
 f.state.transactionHr=false;await assert.rejects(f.service.create(1,{...input(),shift_type:'NEW'}),e=>e.statusCode===403);assert.equal(f.state.rows.length,1);
});
test('duplicate comparison covers legacy lowercase codes and INACTIVE schedules',async()=>{
 for(const status of ['ACTIVE','INACTIVE']){const f=fixture();f.state.rows=[{id:1,...input(),shift_type:'mid',status}];for(const code of ['MID','mid','MiD',' mid '])await assert.rejects(f.service.create(1,{...input(),shift_type:code}),e=>e.statusCode===409);assert.equal(f.state.rows.length,1);}
});
test('shift-code lock precedes duplicate lookup and insert; audit failure rolls back',async()=>{
 const f=fixture();f.state.failAudit=true;await assert.rejects(f.service.create(1,input()),/audit failed/);assert.equal(f.state.rows.length,0);const q=f.state.queries.map(q=>q.sql);assert(q.findIndex(s=>s.includes('pg_advisory_xact_lock'))<q.findIndex(s=>s.includes('upper(btrim')));assert.equal(q.at(-1),'ROLLBACK');
});
test('PATCH cannot bypass same-day time rules or shift uniqueness; self-normalization is allowed',async()=>{
 const f=fixture(),a=await f.service.create(1,input());await f.service.create(1,{...input(),shift_type:'OTHER'});
 await assert.rejects(f.service.update(1,String(a.id),{shift_type:'other'}),e=>e.statusCode===409);
 const updated=await f.service.update(1,String(a.id),{shift_type:' mId '});assert.equal(updated.shift_type,'MID');
 await assert.rejects(f.service.update(1,String(a.id),{end_time:'06:00'}),e=>e.statusCode===400);
 assert.equal(prepareScheduleUpdate(a,true,{start_time:'12:00'}).start_time,'12:00');
 assert.equal(prepareScheduleUpdate({...a,is_default:true,attendance_policy:{}},true,{end_time:'21:00'}).end_time,'21:00');
 for(const extra of [{attendance_policy:{}},{is_default:true}])await assert.rejects(f.service.create(1,{...input(),...extra}),e=>e.statusCode===400);
});
test('HTTP POST validates permission, 201 normalization, 409 duplicates and invalid time ordering',async()=>{
 const express=require('express'),app=express(),f=fixture();app.use(express.json());app.use('/api/work-schedules',createWorkSchedulesRouter({service:f.service,authenticate:(req,res,next)=>{if(!req.headers.authorization)return res.sendStatus(401);req.auth={userId:Number(req.headers.authorization)};next();}}));app.use(errorHandler);const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 try{const url=`http://127.0.0.1:${server.address().port}/api/work-schedules`,post=(body,actor='1')=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json',...(actor?{Authorization:actor}:{})},body:JSON.stringify(body)});
 assert.equal((await post(input(),'')).status,401);assert.equal((await post(input(),'2')).status,403);assert.equal((await post(input(),'3')).status,403);
 const r=await post(input());assert.equal(r.status,201);assert.equal((await r.json()).data.shift_type,'MID');assert.equal((await post({...input(),shift_type:'mId'})).status,409);assert.equal((await post({...input(),shift_type:'NEW',break_end:'21:00'})).status,400);
 }finally{await new Promise(r=>server.close(r));}
});

test('attendance import matches legacy and new shift codes without case distinctions',async()=>{
 const {AttendanceImportService}=require('../src/modules/attendance/services/attendance-import.service');
 const db={query:async()=>({rows:[]})};
 const repo={references:async()=>({employees:[{id:1,employee_code:'EMP001',full_name:'Employee',hire_date:'2020-01-01',work_schedule_id:1}],schedules:[{id:1,shift_type:'mid',status:'ACTIVE',start_time:'11:00:00',end_time:'20:00:00',break_start:'15:00:00',break_end:'16:00:00',working_days:[1,2,3,4,5],attendance_policy:{}}]}),current:async()=>null,overlapping:async()=>[]};
 const service=new AttendanceImportService(repo,{clock:()=>new Date('2026-11-19T21:00:00+07:00')});
 for(const shift_type of ['MID','mid','MiD',' MID ']){const [r]=await service.build(db,[{excel_row:2,employee_code:'EMP001',shift_type,check_in:'2026-11-16T11:00:00+07:00',check_out:'2026-11-16T20:00:00+07:00'}]);assert.equal(r.action,'INSERT');assert(!r.issues.some(i=>i.severity==='ERROR'));}
});

test('assigned shift can change hours, days and status; list exposes no default state',async()=>{
 const f=fixture(),row=await f.service.create(1,input());
 const edited=await f.service.update(1,String(row.id),{start_time:'10:00',end_time:'21:00',working_days:[1,2,3],status:'INACTIVE'});
 assert.equal(edited.end_time,'21:00');assert.equal(edited.status,'INACTIVE');
 assert(!f.state.queries.some(q=>q.sql.includes('SELECT EXISTS(SELECT 1 FROM employees')));
 assert.equal(Object.hasOwn(edited,'attendance_policy'),false);
 for(const patch of [{attendance_policy:{}},{is_default:true}])await assert.rejects(f.service.update(1,String(row.id),patch),e=>e.statusCode===400);
 f.repo.findAll=async()=>[edited];
 assert.deepEqual(await f.service.list(1),[edited]);
 await assert.rejects(f.service.setDefault(1,'1',{}),e=>e.statusCode===410);
});
