const {test}=require('node:test'),assert=require('node:assert/strict');
const R=require('../src/modules/attendance/helpers/attendance-import.rules');
const {AttendanceImportService}=require('../src/modules/attendance/services/attendance-import.service');
const {AttendanceImportRepository}=require('../src/modules/attendance/repositories/attendance-import.repository');
const {LeaveRecordsRepository}=require('../src/modules/leave-records/leave-records.repository');
const Sources=require('../src/modules/attendance/services/attendance-sources.service');
const secret='business-tests-stateless-preview-secret-12345';
function fixture(){
 const state={holidays:[],leaves:[],attendance:[],overlaps:[],queries:[],writes:[],employee:{id:1,employee_code:'EMP001',full_name:'Employee',hire_date:'2026-11-01',work_schedule_id:1},schedule:{id:1,shift_type:'MID',status:'ACTIVE',start_time:'11:00:00',end_time:'20:00:00',break_start:'15:00:00',break_end:'16:00:00',working_days:[1,2,3,4,5]}};
 const db={query:async(sql,args)=>{state.queries.push({sql,args});if(sql.includes('FROM holidays'))return {rows:state.holidays};if(sql.includes('FROM employee_leave_records'))return {rows:state.leaves};if(sql.includes('FROM attendance'))return {rows:state.attendance};return {rows:[]};}};
 const repo={pool:db,references:async()=>({employees:[state.employee],schedules:[state.schedule]}),transaction:async fn=>fn(db),actor:async()=>({id:7,role_name:'HR'}),overlapping:async()=>state.overlaps,current:async(_db,_id,date)=>state.attendance.find(a=>a.work_date===date&&a.record_status==='ACTIVE')||null,calendarSources:async()=>({holidays:state.holidays,leaves:state.leaves}),lockKey:async()=>{},write:async(_db,row,before,_user,reason)=>{state.writes.push({...row,before,reason});return {id:before?.id||99};}};
 const service=new AttendanceImportService(repo,{previewSecret:secret,clock:()=>new Date('2026-11-18T21:00:00+07:00')});
 return {state,repo,db,service};
}
const row=(a='2026-11-16 11:00:00',b='2026-11-16 20:00:00',n=2)=>({excel_row:n,employee_code:'EMP001',shift_type:'MID',check_in:R.timestamp(a),check_out:R.timestamp(b)});
test('hire date, future timestamps, missing assignment and wrong shift are blocked',async()=>{
 for(const [kind,code] of [['hire','ATT-019'],['future','ATT-018'],['unassigned','ATT-016'],['shift','ATT-017']]){const f=fixture();let input=row();if(kind==='hire')f.state.employee.hire_date='2026-11-17';if(kind==='future')input=row('2026-11-19 11:00:00','2026-11-19 20:00:00');if(kind==='unassigned')f.state.employee.work_schedule_id=null;if(kind==='shift')input.shift_type='DAY';const result=await f.service.build(f.db,[input]);assert(result[0].issues.some(i=>i.code===code));assert.equal(result[0].action,'BLOCKED');}
});
test('MID mismatched punches alert HR; overtime starts at 20:00, early arrival never becomes overtime',async()=>{
 const f=fixture(),r=(await f.service.build(f.db,[row('2026-11-16 09:30:00','2026-11-16 17:30:00')]))[0];assert.equal(r.overtime_minutes,0);assert.equal(r.early_mins,150);assert(r.issues.some(i=>i.code==='ATT-024'&&i.message.includes('150')));assert(r.issues.some(i=>i.code==='ATT-020'));assert.equal(r.validation_status,'WARNING');
 const x=R.calculate('2026-11-16',R.timestamp('2026-11-16 11:00:00'),R.timestamp('2026-11-16 22:00:00'),f.state.schedule);assert.equal(x.overtime_minutes,120);assert.equal(x.working_minutes,600);
});
test('zero net working time during the entire break is rejected',async()=>{const f=fixture();const r=(await f.service.build(f.db,[row('2026-11-16 15:00:00','2026-11-16 16:00:00')]))[0];assert(r.issues.some(i=>i.code==='ATT-022'));});
test('overlap is checked against stored records even on a different work date',async()=>{const f=fixture();f.state.overlaps=[{id:3,work_date:'2026-11-15'}];const result=await f.service.build(f.db,[row()]);assert(result[0].issues.some(i=>i.code==='ATT-021'));});
test('overlapping intervals in a file block both rows including overlap within breaks',async()=>{const f=fixture();const rows=await f.service.build(f.db,[row(),row('2026-11-16 14:00:00','2026-11-16 21:00:00',3)]);assert(rows.every(r=>r.issues.some(i=>i.code==='ATT-021')));});
test('ACTIVE duplicate with different times requires cancellation; cancelled rows are excluded by repository lookup',async()=>{
 const f=fixture();f.state.attendance=[{id:10,work_date:'2026-11-16',record_status:'ACTIVE',check_in:'different'}];const rows=await f.service.build(f.db,[row()]);assert.equal(rows[0].action,'CONFLICT');assert(rows[0].issues.some(i=>i.code==='ATT-012'&&i.severity==='ERROR'));
 const repo=new AttendanceImportRepository(f.db);await repo.current(f.db,1,'2026-11-16');assert(f.state.queries.some(q=>q.sql.includes("record_status='ACTIVE'")));
});
test('empty rows classify by sources, schedule and explicit completeness; partial rows remain incomplete',async()=>{
 const f=fixture();
 f.state.holidays=[{id:1,start_date:'2026-11-16',end_date:'2026-11-16'}];
 f.state.leaves=[{id:2,employee_id:1,start_date:'2026-11-16',end_date:'2026-11-17'}];
 const rows=['2026-11-16','2026-11-17','2026-11-15','2026-11-18','2026-11-19'].map((work_date,i)=>({
   excel_row:i+2,employee_code:'EMP001',shift_type:'MID',work_date,check_in:null,check_out:null
 }));
 assert.deepEqual((await f.service.build(f.db,rows)).map(r=>r.attendance_status),['HOLIDAY','ON_LEAVE','DAY_OFF',undefined,undefined]);
 assert.deepEqual((await f.service.build(f.db,rows,{},true)).map(r=>r.attendance_status),['HOLIDAY','ON_LEAVE','DAY_OFF','ABSENT',undefined]);
 const partial={...rows[3],excel_row:10,check_in:'2026-11-18T11:00:00+07:00'};
 const result=await f.service.build(f.db,[rows[3],partial],{},true);
 assert.deepEqual(result.map(r=>r.validation_status),['NO_DATA','INCOMPLETE']);
});
const selection={from:'2026-11-16',to:'2026-11-18',employee_ids:[1]};
test('explicit reconciliation: holiday has priority over leave, missing days are not inferred ABSENT',async()=>{
 const f=fixture();f.state.holidays=[{id:1,start_date:'2026-11-16',end_date:'2026-11-16'}];f.state.leaves=[{id:2,employee_id:1,start_date:'2026-11-16',end_date:'2026-11-17'}];
 const p=await Sources.reconcile(f.service,{id:7},{scope:selection});assert.deepEqual(p.rows.map(r=>r.attendance_status),['HOLIDAY','ON_LEAVE']);assert.equal(f.state.writes.length,0);assert.equal(p.rows[0].check_in,null);assert.deepEqual(p.rows[0].derived_source.leave_record_ids,[]);
 const c=await Sources.reconcile(f.service,{id:7},{scope:selection,preview_token:p.preview_token},true);assert.equal(c.inserted,2);assert(f.state.writes.every(r=>r.working_minutes===0&&r.overtime_minutes===0));
});
test('actual holiday work is preserved, warning acknowledged, no leave row added',async()=>{
 const f=fixture();f.state.holidays=[{id:1,start_date:'2026-11-16',end_date:'2026-11-16'}];f.state.attendance=[{id:3,employee_id:1,work_date:'2026-11-16',check_in:'11:00',check_out:'20:00',working_minutes:480,attendance_status:'PRESENT',record_status:'ACTIVE'}];
 const p=await Sources.reconcile(f.service,{id:7},{scope:selection});assert.equal(p.rows[0].action,'KEEP');assert(p.rows[0].warning);
 await assert.rejects(Sources.reconcile(f.service,{id:7},{scope:selection,preview_token:p.preview_token},true),{code:'WARNINGS_UNCONFIRMED'});
 const c=await Sources.reconcile(f.service,{id:7},{scope:selection,preview_token:p.preview_token,confirm_warnings:true},true);assert.equal(c.inserted,0);assert.equal(c.kept,1);
});
test('explicit reconciliation keeps existing absence until it is cancelled',async()=>{
 const f=fixture();
 f.state.leaves=[{id:2,employee_id:1,start_date:'2026-11-16',end_date:'2026-11-16'}];
 f.state.attendance=[{id:10,employee_id:1,work_date:'2026-11-16',attendance_status:'ABSENT',record_status:'ACTIVE'}];
 const p=await Sources.reconcile(f.service,{id:7},{scope:selection});
 assert.equal(p.rows[0].action,'KEEP');
 const options={scope:selection,preview_token:p.preview_token,confirm_warnings:true};
 const result=await Sources.reconcile(f.service,{id:7},options,true);
 assert.equal(result.kept,1);assert.equal(f.state.writes.length,0);
});
test('changed source, changed scope or wrong actor cannot confirm old reconciliation preview',async()=>{
 const f=fixture(),p=await Sources.reconcile(f.service,{id:7},{scope:selection});
 await assert.rejects(Sources.reconcile(f.service,{id:8},{scope:selection,preview_token:p.preview_token},true),{code:'INVALID_PREVIEW'});
 await assert.rejects(Sources.reconcile(f.service,{id:7},{scope:{...selection,to:'2026-11-17'},preview_token:p.preview_token},true),{code:'STALE_PREVIEW'});
 f.state.holidays=[{id:1,start_date:'2026-11-16',end_date:'2026-11-16'}];await assert.rejects(Sources.reconcile(f.service,{id:7},{scope:selection,preview_token:p.preview_token},true),{code:'STALE_PREVIEW'});assert.equal(f.state.writes.length,0);
});
test('reconciliation excludes weekends, future shifts and dates before hire; rejects oversized/duplicate selections',async()=>{
 const f=fixture();f.state.employee.hire_date='2026-11-17';f.state.leaves=[{id:2,employee_id:1,start_date:'2026-11-01',end_date:'2026-11-30'}];const p=await Sources.reconcile(f.service,{id:7},{scope:{...selection,from:'2026-11-14',to:'2026-11-20'}});assert.deepEqual(p.rows.map(r=>r.work_date),['2026-11-17','2026-11-18']);
 assert.throws(()=>Sources.scope({...selection,employee_ids:[1,1]}));assert.throws(()=>Sources.scope({...selection,to:'2028-11-18'}));
});
test('leave before hire is rejected and full period conflicts with worked holidays',async()=>{
 let attendanceConflict=false;const db={query:async sql=>({rows:sql.includes('FROM employees')?[{id:1,hire_date:'2026-11-17'}]:sql.includes('FROM leave_types')?[{id:1}]:sql.includes('FROM attendance')&&attendanceConflict?[{attendance_id:7,work_date:'2026-11-18'}]:[]})};const repo=new LeaveRecordsRepository(db);
 await assert.rejects(repo.validate(db,{employee_id:1,leave_type_id:1,start_date:'2026-11-16',end_date:'2026-11-18'}),{code:'BEFORE_HIRE_DATE'});
 attendanceConflict=true;await assert.rejects(repo.validate(db,{employee_id:1,leave_type_id:1,start_date:'2026-11-17',end_date:'2026-11-18'}),{code:'ATTENDANCE_CONFLICT'});
});
test('cancellation requires reason, uses existing audit, no version/cancelled_at columns, and preserves cancelled record',async()=>{
 const f=fixture();let stored={id:12,employee_id:1,work_date:'2026-11-16',record_status:'ACTIVE',updated_at:'2026-11-18T10:00:00+07:00'};f.repo.find=async()=>({...stored});f.repo.audit=async(_db,_actor,action,before,after,reason)=>{assert.equal(action,'CANCEL');assert.equal(before.record_status,'ACTIVE');assert.equal(after.record_status,'CANCEL');assert.equal(reason,'Correct imported source');};
 const query=f.db.query;f.db.query=async(sql,args)=>{if(sql.startsWith('UPDATE attendance')){assert(!/version|cancelled_at/.test(sql));stored={...stored,record_status:'CANCEL',cancellation_reason:args[1],cancelled_by:args[2]};}return query(sql,args);};
 await assert.rejects(f.service.cancel({id:7},12,{reason:' '}),{code:'VALIDATION_ERROR'});
 const result=await f.service.cancel({id:7},12,{reason:'Correct imported source'});assert.equal(result.data.record_status,'CANCEL');assert.equal(result.data.cancelled_by,7);await assert.rejects(f.service.cancel({id:7},12,{reason:'Again'}),{code:'INVALID_TRANSITION'});
});
