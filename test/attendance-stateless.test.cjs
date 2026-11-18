const {test}=require('node:test'),assert=require('node:assert/strict'),ExcelJS=require('exceljs'),jwt=require('jsonwebtoken');
const {AttendanceImportService}=require('../src/modules/attendance/attendance-import.service');
const {AttendanceImportRepository}=require('../src/modules/attendance/attendance-import.repository');
const {AppError}=require('../src/common/errors/app-error');
const secret='unit-test-preview-key-32-characters-minimum';
async function file(times=['2026-11-16 08:00:00','2026-11-16 17:00:00']){const w=new ExcelJS.Workbook(),s=w.addWorksheet('Attendance');s.addRow(['employee_code','employee_name','shift_type','check_in','check_out']);s.addRow(['EMP001','Test Employee','DAY',...times]);return {originalname:'attendance.xlsx',buffer:Buffer.from(await w.xlsx.writeBuffer())};}
function fixture(){
 const state={stored:null,writes:0,holiday:false,queries:[],employee:{id:1,employee_code:'EMP001',full_name:'Test Employee',hire_date:'2026-01-01',work_schedule_id:1},schedule:{id:1,shift_type:'DAY',start_time:'08:00:00',end_time:'17:00:00',break_start:'12:00:00',break_end:'13:00:00',working_days:[1,2,3,4,5],status:'ACTIVE',attendance_policy:{}}};
 const db={async query(sql){state.queries.push(sql);assert(!/attendance_import_batches|source_batch_id|attendance_audit_logs|CREATE TEMP|ALTER TABLE/.test(sql),'no persistence of import metadata or schema changes');return {rows:sql.includes('FROM holidays')&&state.holiday?[{id:1,name:'Company holiday',start_date:'2026-11-16',end_date:'2026-11-16',employment_type:'PART_TIME'}]:[]};}};
 const repo={pool:db,actor:async(_db,id)=>{if(![1,2].includes(id))throw new AppError(403,'Only HR');return {id,role_name:'HR'};},references:async()=>({employees:[state.employee],schedules:[state.schedule]}),transaction:async work=>work(db),current:async()=>state.stored,overlapping:async()=>[],lockKey:async()=>{},write:async(_db,row)=>{state.writes++;state.stored={...row,id:99,version:1,record_status:'ACTIVE',check_in:row.check_in,check_out:row.check_out,work_schedule_id:row.work_schedule_id,schedule_snapshot:row.schedule_snapshot,calculation_version:'excel-v1'};return {id:99};}};
 return {state,repo,service:new AttendanceImportService(repo,{previewSecret:secret})};
}
test('preview is stateless; confirm resubmits file and no import metadata is persisted',async()=>{
 const {state,service}=fixture(),f=await file(),p=await service.preview({id:1},f);assert.equal(p.status,'READY');assert.equal(state.writes,0);assert.equal(p.batch_id,undefined);assert.equal(typeof p.preview_token,'string');
 const r=await service.confirm({id:1},f,{preview_token:p.preview_token});assert.equal(r.inserted,1);assert.equal(state.writes,1);assert.equal(r.batch_id,undefined);
 await assert.rejects(service.confirm({id:1},f,{preview_token:p.preview_token}),e=>e.code==='STALE_PREVIEW');assert.equal(state.writes,1);
 const fresh=await service.preview({id:1},f);assert.equal((await service.confirm({id:1},f,{preview_token:fresh.preview_token})).skipped,1);assert.equal(state.writes,1);
});
test('wrong HR, changed file, changed choices, forged/expired tokens and missing token are rejected',async()=>{
 const {state,service}=fixture(),f=await file(),p=await service.preview({id:1},f);
 await assert.rejects(service.confirm({id:2},f,{preview_token:p.preview_token}),e=>e.code==='INVALID_PREVIEW');
 await assert.rejects(service.confirm({id:1},await file(['2026-11-16 08:10:00','2026-11-16 17:00:00']),{preview_token:p.preview_token}),e=>e.code==='STALE_PREVIEW');
 await assert.rejects(service.confirm({id:1},f,{preview_token:p.preview_token,choices:[{excel_row:2,exclude:true}]}),e=>e.code==='STALE_PREVIEW');
 const old=jwt.sign({purpose:'ATTENDANCE_PREVIEW'},secret,{algorithm:'HS256',issuer:'eris-attendance',subject:'1',expiresIn:-1});
 for(const token of [undefined,'forged',old])await assert.rejects(service.confirm({id:1},f,{preview_token:token}),e=>e.code==='INVALID_PREVIEW');assert.equal(state.writes,0);
});
test('schedule, employee and holiday changes invalidate preview',async()=>{
 for(const kind of ['schedule','employee','holiday']){const {state,service}=fixture(),f=await file(),p=await service.preview({id:1},f);if(kind==='schedule')state.schedule.end_time='18:00:00';else if(kind==='employee')state.employee.full_name='New Name';else state.holiday=true;await assert.rejects(service.confirm({id:1},f,{preview_token:p.preview_token,confirm_warnings:true}),e=>e.code==='STALE_PREVIEW');assert.equal(state.writes,0);}
});
test('holiday warnings require acknowledgment and are preserved in result',async()=>{
 const {state,service}=fixture();state.holiday=true;const f=await file(),p=await service.preview({id:1},f);assert(p.rows[0].issues.some(i=>i.code==='PART_TIME_HOLIDAY_WORK'));
 await assert.rejects(service.confirm({id:1},f,{preview_token:p.preview_token}),e=>e.code==='WARNINGS_UNCONFIRMED');
 const r=await service.confirm({id:1},f,{preview_token:p.preview_token,confirm_warnings:true});assert.equal(r.inserted,1);assert.equal(r.rows[0].warnings[0].code,'PART_TIME_HOLIDAY_WORK');
});
test('row exclusion is re-previewed, bound to token and never writes excluded attendance',async()=>{
 const {state,service}=fixture(),f=await file(),choices=[{excel_row:2,exclude:true}],p=await service.preview({id:1},f,{choices});const r=await service.confirm({id:1},f,{preview_token:p.preview_token,choices});assert.equal(r.excluded,1);assert.equal(state.writes,0);
 await assert.rejects(service.preview({id:1},f,{choices:[{excel_row:99,exclude:true}]}),e=>e.code==='VALIDATION_ERROR');
});
test('repository writes attendance plus existing audit_logs only; no batch fields in SQL',async()=>{
 const queries=[],db={async query(sql,args){queries.push({sql,args});if(sql.startsWith('INSERT INTO attendance('))return {rows:[{id:9}]};return {rows:[]};}};
 const repo=new AttendanceImportRepository(db);repo.find=async()=>({id:9});
 const row={employee_id:1,work_date:'2026-11-16',work_schedule_id:1,check_in:'2026-11-16T08:00:00+07:00',check_out:'2026-11-16T17:00:00+07:00',working_minutes:480,late_mins:0,early_mins:0,overtime_minutes:0,outside_shift_minutes:0,schedule_snapshot:{}};
 await repo.write(db,row,null,1);const insert=queries.find(q=>q.sql.startsWith('INSERT INTO attendance('));assert.equal(insert.args.length,10);assert(queries.some(q=>q.sql.includes('INSERT INTO audit_logs')));assert(!queries.some(q=>/attendance_import_batches|source_batch_id|attendance_audit_logs|filename|file_hash/.test(q.sql)));assert(!/outside_shift_minutes|schedule_snapshot|calculation_version|version|leave_type/.test(insert.sql));
});
test('HTTP multipart preview/confirm uses new paths and old history returns 410',async()=>{
 const express=require('express'),{createAttendanceRouter}=require('../src/modules/attendance/attendance.routes'),app=express(),{service,repo}=fixture();
 app.use('/api/attendance',createAttendanceRouter({service,databasePool:repo.pool,authenticate:(req,res,next)=>{if(!req.headers.authorization)return res.sendStatus(401);req.auth={userId:Number(req.headers.authorization)};next();}}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 try{const base=`http://127.0.0.1:${server.address().port}/api/attendance`,f=await file(),call=async(endpoint,opts)=>{const body=new FormData();body.append('file',new Blob([f.buffer]),f.originalname);if(opts)body.append('options',JSON.stringify(opts));return fetch(base+endpoint,{method:'POST',headers:{Authorization:'1'},body});};
 assert.equal((await fetch(base+'/import/history',{headers:{Authorization:'1'}})).status,410);const p=await (await call('/import/preview')).json();assert(p.preview_token);const confirmed=await call('/import/confirm',{preview_token:p.preview_token});assert.equal(confirmed.status,200);assert.equal((await confirmed.json()).inserted,1);
 }finally{await new Promise(r=>server.close(r));}
});
