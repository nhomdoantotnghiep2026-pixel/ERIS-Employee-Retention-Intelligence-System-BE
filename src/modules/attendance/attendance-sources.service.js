// Explicit HR-selected reconciliation. No ABSENT inference and no persisted upload metadata.
const jwt=require('jsonwebtoken');
const R=require('./attendance-import.rules');
const {calendarLock}=require('../holidays/holidays');
const {lockEmployee}=require('../leave-records/leave-records.repository');
function scope(input){
 R.object(input,['from','to','employee_ids']);const from=R.date(input.from),to=R.date(input.to);
 if(from>to)R.fail('VALIDATION_ERROR','from must be on or before to.');
 if(!Array.isArray(input.employee_ids)||!input.employee_ids.length||input.employee_ids.length>100)R.fail('VALIDATION_ERROR','Select 1–100 employees.');
 const ids=input.employee_ids.map(x=>{const id=Number(R.id(x));if(id>2147483647)R.fail('VALIDATION_ERROR','Employee ID out of range.');return id;}).sort((a,b)=>a-b);
 const days=(Date.parse(to)-Date.parse(from))/86400000+1;
 if(new Set(ids).size!==ids.length||days>366||days*ids.length>10000)R.fail('VALIDATION_ERROR','Use unique employees, at most 366 days and 10000 employee-days.');
 return {from,to,employee_ids:ids};
}
async function build(service,db,s){
 const refs=await service.repo.references(db),employees=new Map(refs.employees.map(e=>[e.id,e]));
 if(s.employee_ids.some(id=>!employees.has(id)))R.fail('EMPLOYEE_NOT_FOUND','A selected employee no longer exists.');
 const [holidays,leaves,attendance]=await Promise.all([
  db.query("SELECT id,start_date::text,end_date::text FROM holidays WHERE status='ACTIVE' AND start_date<=$2::date AND end_date>=$1::date ORDER BY id",[s.from,s.to]),
  db.query("SELECT id,employee_id,start_date::text,end_date::text FROM employee_leave_records WHERE record_status='ACTIVE' AND employee_id=ANY($1::int[]) AND start_date<=$3::date AND end_date>=$2::date ORDER BY id",[s.employee_ids,s.from,s.to]),
  db.query("SELECT id,employee_id,work_date::text,attendance_status,check_in,check_out,working_minutes,overtime_minutes FROM attendance WHERE record_status='ACTIVE' AND employee_id=ANY($1::int[]) AND work_date BETWEEN $2::date AND $3::date ORDER BY id",[s.employee_ids,s.from,s.to])
 ]);
 const existing=new Map(attendance.rows.map(a=>[`${a.employee_id}:${a.work_date}`,a])),rows=[],now=service.clock().getTime();
 for(const id of s.employee_ids){
  const e=employees.get(id),w=refs.schedules.find(w=>w.id===e.work_schedule_id&&w.status==='ACTIVE');
  if(!e.hire_date||!w){rows.push({employee_id:id,employee_code:e.employee_code,action:'ERROR',message:'Employee needs a hire date and an assigned ACTIVE work schedule.'});continue;}
  for(let day=Date.parse(s.from);day<=Date.parse(s.to);day+=86400000){
   const d=new Date(day).toISOString().slice(0,10);
   if(d<e.hire_date||!(w.working_days||[]).includes(new Date(day).getUTCDay()||7)||R.timeline(d,w).end>now)continue;
   const h=holidays.rows.filter(h=>h.start_date<=d&&h.end_date>=d),l=leaves.rows.filter(l=>l.employee_id===id&&l.start_date<=d&&l.end_date>=d);
   const current=existing.get(`${id}:${d}`),status=h.length?'HOLIDAY':l.length?'ON_LEAVE':null;
   if(!status)continue; // Missing punches alone never establish absence or leave.
   const worked=current&&(current.check_in||current.check_out||Number(current.working_minutes)>0||Number(current.overtime_minutes)>0);
   rows.push({employee_id:id,employee_code:e.employee_code,full_name:e.full_name,work_date:d,work_schedule_id:w.id,
    check_in:null,check_out:null,working_minutes:0,overtime_minutes:0,late_mins:0,early_mins:0,attendance_status:status,
    action:current?'KEEP':'INSERT',existing_id:current?.id||null,
    warning:worked?'Existing work record is preserved; this day is not counted as leave.':current&&current.attendance_status!==status?'Stored status differs from source priority. Cancel the old attendance, then preview again.':null,
    derived_source:{holiday_ids:h.map(x=>x.id),leave_record_ids:status==='ON_LEAVE'?l.map(x=>x.id):[]},
    schedule_snapshot:R.scheduleSnapshot(w)});
  }
 }
 return rows;
}
async function reconcile(service,user,body,confirm=false){
 R.object(body,confirm?['scope','preview_token','confirm_warnings']:['scope']);const s=scope(body.scope);
 if(typeof service.previewSecret!=='string'||service.previewSecret.length<24)R.fail('PREVIEW_UNAVAILABLE','Preview signing key is not configured.',503);
 let proof;
 if(confirm){try{proof=jwt.verify(body.preview_token,service.previewSecret,{algorithms:['HS256'],issuer:'eris-attendance-sources',subject:String(user.id)});}catch{R.fail('INVALID_PREVIEW','Preview expired or invalid; preview again.',409);}
  if(proof.scopeHash!==R.hash(s))R.fail('STALE_PREVIEW','Selection changed; preview again.',409);
  if(body.confirm_warnings!==undefined&&typeof body.confirm_warnings!=='boolean')R.fail('VALIDATION_ERROR','confirm_warnings must be boolean.');
 }
 return service.repo.transaction(async db=>{
  await service.repo.actor(db,user.id,true,true);await calendarLock(db,true);
  if(confirm){for(const id of s.employee_ids){await lockEmployee(db,id);await db.query('SELECT id FROM employees WHERE id=$1 FOR SHARE',[id]);}await db.query('SELECT id FROM work_schedules ORDER BY id FOR SHARE');}
  const rows=await build(service,db,s),hash=R.hash(rows);
  const summary={prepared:rows.filter(r=>r.action==='INSERT').length,kept:rows.filter(r=>r.action==='KEEP').length,errors:rows.filter(r=>r.action==='ERROR').length};
  if(!confirm)return {scope:s,rows,summary,status:summary.errors?'PREVIEWED':'READY',preview_token:jwt.sign({scopeHash:R.hash(s),viewHash:hash},service.previewSecret,{algorithm:'HS256',issuer:'eris-attendance-sources',subject:String(user.id),expiresIn:'30m'})};
  if(hash!==proof.viewHash)R.fail('STALE_PREVIEW','Employee, schedule, attendance, leave or holidays changed; preview again.',409);
  if(summary.errors)R.fail('UNRESOLVED_ROWS','Resolve employee/schedule errors before confirming.',409);
  if(rows.some(r=>r.warning)&&!body.confirm_warnings)R.fail('WARNINGS_UNCONFIRMED','HR must acknowledge source reconciliation warnings.',409);
  let inserted=0;for(const row of rows.filter(r=>r.action==='INSERT')){await service.repo.lockKey(db,row.employee_id,row.work_date);if(await service.repo.current(db,row.employee_id,row.work_date,true))R.fail('STALE_PREVIEW','Attendance changed; preview again.',409);await service.repo.write(db,row,null,user.id,'HR confirmed holiday/leave reconciliation');inserted++;}
  return {status:'CONFIRMED',scope:s,inserted,kept:summary.kept};
 });
}
module.exports={scope,build,reconcile};
