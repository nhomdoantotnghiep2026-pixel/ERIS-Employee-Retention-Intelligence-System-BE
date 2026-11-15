const { randomUUID, createHash } = require('node:crypto');
const R = require('./attendance-import.rules');
const { parseWorkbook, errorsWorkbook } = require('./attendance-import.excel');
const issue=(code,message,severity='ERROR',requires_resolution=false)=>({code,message,severity,requires_resolution});
const same=(row,current)=>!!current && current.record_status==='ACTIVE' &&
  current.check_in===row.check_in && current.check_out===row.check_out && current.work_schedule_id===row.work_schedule_id &&
  R.hash(current.schedule_snapshot)===R.hash(row.schedule_snapshot) && current.calculation_version===R.CALCULATION_VERSION;
const existingToken=current=>current ? {id:current.id,version:current.version,fingerprint:R.hash(current)} : null;
function batchId(id) { if(typeof id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) R.fail('VALIDATION_ERROR','Invalid batch ID.'); return id; }
function editable(batch) { if(batch.status==='CONFIRMED')R.fail('BATCH_CONFIRMED','Batch already confirmed.',409); if(batch.expired)R.fail('BATCH_EXPIRED','Batch expired; upload again.',409); }
function batchView(batch) { return {batch_id:batch.id,status:batch.status,created_at:batch.created_at,expires_at:batch.expires_at,expired:batch.expired||false,rows:batch.rows,result:batch.result}; }
class AttendanceImportService {
  constructor(repository) { this.repo=repository; }
  async build(db, input, choices={}) {
    const refs=await this.repo.references(db), employees=new Map(refs.employees.map(e=>[e.employee_code,e])), schedules=new Map(refs.schedules.map(s=>[s.shift_type,s]));
    const rows=[];
    for(const source of input) {
      const row={...source,issues:[...(source.parse_issues||[])],action:'BLOCKED',validation_status:'VALID'}, choice=choices[source.excel_row]||{};
      const employee=employees.get(row.employee_code), schedule=schedules.get(row.shift_type);
      if(!employee) row.issues.push(issue('ATT-003','Employee code does not exist.'));
      if(!schedule || schedule.status!=='ACTIVE') row.issues.push(issue('ATT-004','Shift type does not identify an active schedule.'));
      if(employee) { row.employee_id=employee.id; row.full_name=employee.full_name; if(row.employee_name && row.employee_name.normalize('NFC')!==employee.full_name.normalize('NFC'))row.issues.push(issue('ATT-009','Employee name differs from the employee profile.','WARNING')); }
      if(schedule) { row.work_schedule_id=schedule.id; row.schedule_snapshot=R.scheduleSnapshot(schedule); }
      if(!row.check_in&&!row.check_out) { row.validation_status='NO_DATA';row.issues.push(issue('ATT-015','Both timestamps are empty.','INFO')); }
      else if(!row.check_in||!row.check_out) { row.validation_status='INCOMPLETE';row.issues.push(issue('ATT-014','Both check_in and check_out are required.','INFO')); }
      else if(Date.parse(row.check_out)<=Date.parse(row.check_in))row.issues.push(issue('ATT-006','check_out must be after check_in.'));
      if(!row.issues.some(i=>i.severity==='ERROR') && row.check_in && row.check_out) {
        const duration=(Date.parse(row.check_out)-Date.parse(row.check_in))/R.MINUTE, p=R.policy(schedule.attendance_policy);
        if(duration>p.max_duration_minutes)row.issues.push(issue('ATT-010','Duration exceeds the configured maximum.'));
        else if(duration>p.unusual_duration_minutes)row.issues.push(issue('ATT-010','Unusually long attendance duration.','WARNING'));
        try {
          row.candidates=R.candidates(row.check_in,row.check_out,schedule);
          if(!row.candidates.length)row.issues.push(issue('ATT-007','No shift candidate matches the configured time windows.'));
          else if(row.candidates.length>1&&!choice.work_date)row.issues.push(issue('ATT-008','Select one shift date before confirming.','WARNING',true));
          else {
            row.work_date=choice.work_date || row.candidates[0];
            if(!row.candidates.includes(row.work_date))R.fail('ATT-007','Selected shift date is not a matching candidate.');
            Object.assign(row,R.calculate(row.work_date,row.check_in,row.check_out,schedule));
            if(!(schedule.working_days||[]).includes(new Date(row.work_date+'T00:00:00Z').getUTCDay()||7))row.issues.push(issue('ATT-011','Attendance is outside the schedule working days.','WARNING'));
            const current=await this.repo.current(db,employee.id,row.work_date);
            row.existing=existingToken(current);row.previous=current;
            row.action=!current?'INSERT':same(row,current)?'SKIP':'CHANGED';
            if(current)row.issues.push(issue('ATT-012',current.record_status==='CANCEL'?'Existing record is cancelled; restore explicitly before import.':'An attendance record already exists.','INFO',current.record_status==='CANCEL'));
            if(current?.record_status==='CANCEL')row.action='BLOCKED';
          }
        }catch(e){ if(!e.code)throw e;row.issues.push(issue(e.code,e.message)); }
      }
      if(row.issues.some(i=>i.severity==='ERROR')) { row.validation_status='ERROR';row.action='BLOCKED'; }
      else if(row.check_in&&row.check_out) row.validation_status=row.issues.some(i=>i.severity==='WARNING')?'WARNING':row.existing?'DUPLICATE':'VALID';
      if(choice.exclude) {row.excluded=true;row.action='SKIP';}
      rows.push(row);
    }
    const groups=new Map();
    for(const row of rows.filter(r=>r.work_date&&!r.excluded&&r.validation_status!=='ERROR')) { const key=`${row.employee_id}:${row.work_date}`;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row); }
    for(const group of groups.values()) if(group.length>1) {
      const first=group[0], identical=group.every(r=>r.check_in===first.check_in&&r.check_out===first.check_out&&R.hash(r.schedule_snapshot)===R.hash(first.schedule_snapshot));
      for(const row of group.slice(identical?1:0)) {
        row.issues.push(issue('ATT-013',identical?'Identical row repeated in this file.':'Different rows target the same employee/date; exclude all but one.','INFO',!identical));
        row.validation_status='DUPLICATE';row.action=identical?'SKIP':'BLOCKED';row.file_duplicate=identical;
      }
    }
    return rows;
  }
  state(rows) { return rows.some(r=>!r.excluded&&(r.validation_status==='ERROR'||r.issues.some(i=>i.requires_resolution)))?'PREVIEWED':'READY'; }
  async preview(user,file) {
    await this.repo.actor(this.repo.pool,user.id,true);
    const input=await parseWorkbook(file);
    return this.repo.transaction(async db=>{
      await this.repo.actor(db,user.id,true,true);
      const rows=await this.build(db,input), id=randomUUID();
      const result=await db.query(`INSERT INTO attendance_import_batches(id,created_by,filename,file_hash,status,rows)
        VALUES($1,$2,$3,$4,$5,$6::jsonb) RETURNING *`,[id,user.id,file.originalname,createHash('sha256').update(file.buffer).digest('hex'),this.state(rows),JSON.stringify(rows)]);
      return batchView(result.rows[0]);
    });
  }
  async batch(user,id) {await this.repo.actor(this.repo.pool,user.id,true);return batchView(await this.repo.batch(this.repo.pool,batchId(id)));}
  async resolve(user,id,excelRow,body) {
    R.object(body,['work_date','exclude']);
    if(body.work_date!==undefined)R.date(body.work_date);
    if(body.exclude!==undefined&&typeof body.exclude!=='boolean')R.fail('VALIDATION_ERROR','exclude must be boolean.');
    return this.repo.transaction(async db=>{
      await this.repo.actor(db,user.id,true,true);const b=await this.repo.batch(db,batchId(id),true);editable(b);
      if(!b.rows.some(r=>r.excel_row===Number(excelRow)))R.fail('NOT_FOUND','Excel row not found.',404);
      const choices=Object.fromEntries(b.rows.map(r=>[r.excel_row,{work_date:r.selected_work_date,exclude:!!r.excluded}]));
      choices[Number(excelRow)]={...choices[Number(excelRow)],...body};
      const sources=b.rows.map(r=>Object.fromEntries(['excel_row','employee_code','employee_name','shift_type','check_in','check_out','parse_issues'].map(k=>[k,r[k]])));
      const rows=await this.build(db,sources,choices);
      for(const row of rows)row.selected_work_date=choices[row.excel_row]?.work_date;
      const result=await db.query('UPDATE attendance_import_batches SET rows=$2::jsonb,status=$3 WHERE id=$1 RETURNING *',[b.id,JSON.stringify(rows),this.state(rows)]);
      return batchView(result.rows[0]);
    });
  }
  async confirm(user,id,body) {
    R.object(body,['duplicate_strategy','confirm_warnings','updates']);
    if(body.duplicate_strategy!==undefined&&body.duplicate_strategy!=='SKIP')R.fail('VALIDATION_ERROR','Only duplicate_strategy SKIP is supported; select individual updates explicitly.');
    if(body.confirm_warnings!==undefined&&typeof body.confirm_warnings!=='boolean')R.fail('VALIDATION_ERROR','confirm_warnings must be boolean.');
    const updates=body.updates===undefined?[]:body.updates;
    if(!Array.isArray(updates))R.fail('VALIDATION_ERROR','updates must be an array.');
    const seen=new Set();
    for(const u of updates) {R.object(u,['excel_row','action','reason']);if(!Number.isInteger(u.excel_row)||seen.has(u.excel_row)||u.action!=='UPDATE')R.fail('VALIDATION_ERROR','Invalid or repeated update decision.');R.reason(u.reason);seen.add(u.excel_row);}
    const decisionHash=R.hash({confirm_warnings:!!body.confirm_warnings,updates:[...updates].sort((a,b)=>a.excel_row-b.excel_row)});
    return this.repo.transaction(async db=>{
      await this.repo.actor(db,user.id,true,true);const b=await this.repo.batch(db,batchId(id),true);
      if(b.status==='CONFIRMED') {if(b.confirm_hash!==decisionHash)R.fail('BATCH_CONFIRMED','Batch was confirmed with different decisions.',409);return b.result;}
      editable(b);
      for(const u of updates)if(!b.rows.some(r=>r.excel_row===u.excel_row&&r.action==='CHANGED'&&!r.excluded))R.fail('VALIDATION_ERROR','Update must refer to a changed, included row.');
      const included=b.rows.filter(r=>!r.excluded&&!['NO_DATA','INCOMPLETE'].includes(r.validation_status));
      if(included.some(r=>r.validation_status==='ERROR'||r.issues.some(i=>i.requires_resolution)))R.fail('UNRESOLVED_ROWS','Resolve or exclude rows with errors, ambiguous shifts, or conflicts before confirming.',409);
      if(included.some(r=>r.issues.some(i=>i.severity==='WARNING'))&&!body.confirm_warnings)R.fail('WARNINGS_UNCONFIRMED','HR must acknowledge preview warnings.',409);
      const result={batch_id:b.id,status:'CONFIRMED',inserted:0,updated:0,skipped:0,excluded:b.rows.length-included.length,rows:[]};
      const scheduleIds=[...new Set(included.filter(r=>r.work_schedule_id).map(r=>r.work_schedule_id))].sort((a,b)=>a-b);
      const schedules=new Map();
      for(const sid of scheduleIds) { const s=(await db.query('SELECT * FROM work_schedules WHERE id=$1 FOR SHARE',[sid])).rows[0];schedules.set(sid,s); }
      const employeeIds=[...new Set(included.map(r=>r.employee_id))].sort((a,b)=>a-b);
      for(const eid of employeeIds) {
        const e=(await db.query('SELECT id,employee_code,full_name FROM employees WHERE id=$1 FOR SHARE',[eid])).rows[0];
        if(!e||included.some(r=>r.employee_id===eid&&(r.employee_code!==e.employee_code||r.full_name!==e.full_name)))R.fail('STALE_PREVIEW','Employee profile changed; preview again.',409);
      }
      for(const row of [...included].sort((a,b)=>a.employee_id-b.employee_id||a.work_date.localeCompare(b.work_date)||a.excel_row-b.excel_row)) {
        const s=schedules.get(row.work_schedule_id);
        if(!s||R.hash(R.scheduleSnapshot(s))!==R.hash(row.schedule_snapshot))R.fail('STALE_PREVIEW','Work schedule changed; preview again.',409);
        // File duplicates are checked through their representative row; they cannot overwrite it.
        if(row.file_duplicate){result.skipped++;result.rows.push({excel_row:row.excel_row,action:'SKIP'});continue;}
        await this.repo.lockKey(db,row.employee_id,row.work_date);
        const current=await this.repo.current(db,row.employee_id,row.work_date,true);
        if(R.hash(existingToken(current))!==R.hash(row.existing||null))R.fail('STALE_PREVIEW','Attendance changed since preview; preview again.',409);
        const update=updates.find(u=>u.excel_row===row.excel_row);
        if(row.action==='SKIP'||row.action==='CHANGED'&&!update) {result.skipped++;result.rows.push({excel_row:row.excel_row,action:'SKIP'});continue;}
        const metrics=R.calculate(row.work_date,row.check_in,row.check_out,row.schedule_snapshot);
        const saved=await this.repo.write(db,{...row,...metrics},current,user.id,update?R.reason(update.reason):null,b.id);
        result[current?'updated':'inserted']++;result.rows.push({excel_row:row.excel_row,action:current?'UPDATE':'INSERT',attendance_id:saved.id});
      }
      await db.query(`UPDATE attendance_import_batches SET status='CONFIRMED',confirmed_at=CURRENT_TIMESTAMP,confirm_hash=$2,result=$3::jsonb WHERE id=$1`,[b.id,decisionHash,JSON.stringify(result)]);
      return result;
    });
  }
  async errors(user,id) {const b=await this.batch(user,id);return errorsWorkbook(b.rows);}
  async history(user,query) {await this.repo.actor(this.repo.pool,user.id,true);const {limit,offset}=this.filters(query);return {data:(await this.repo.pool.query('SELECT id AS batch_id,filename,status,created_by,created_at,confirmed_at,expires_at,result FROM attendance_import_batches ORDER BY created_at DESC LIMIT $1 OFFSET $2',[limit,offset])).rows};}
  filters(query={}) {
    const limit=query.limit===undefined?50:Number(query.limit),offset=query.offset===undefined?0:Number(query.offset);
    if(!Number.isInteger(limit)||limit<1||limit>200||!Number.isInteger(offset)||offset<0||offset>10000000)R.fail('VALIDATION_ERROR','Invalid pagination.');
    const from=query.from?R.date(query.from):null,to=query.to?R.date(query.to):null;
    if(from&&to&&from>to)R.fail('VALIDATION_ERROR','from must be on or before to.');
    if(query.record_status&&!['ACTIVE','CANCEL','ALL'].includes(query.record_status))R.fail('VALIDATION_ERROR','Invalid record_status.');
    const employeeId=query.employee_id?R.id(query.employee_id):null;
    if(employeeId&&BigInt(employeeId)>2147483647n)R.fail('VALIDATION_ERROR','employee_id is out of range.');
    return {limit,offset,from,to,status:query.record_status||'ACTIVE',employeeId};
  }
  async list(user,query={},own=false,summary=false) {
    const actor=await this.repo.actor(this.repo.pool,user.id),f=this.filters(query);
    if(own||actor.role_name!=='HR') {if(!actor.employeeId)R.fail('FORBIDDEN','A linked employee profile is required.',403);f.employeeId=actor.employeeId;}
    if(!own&&!summary&&actor.role_name!=='HR')R.fail('FORBIDDEN','Use /attendance/me to view your records.',403);
    const where=`($1::integer IS NULL OR a.employee_id=$1) AND ($2::date IS NULL OR a.work_date>=$2) AND ($3::date IS NULL OR a.work_date<=$3)
      AND ($4='ALL' OR a.record_status=$4)`;
    const values=[f.employeeId,f.from,f.to,summary?'ACTIVE':f.status];
    if(summary)return {data:(await this.repo.pool.query(`SELECT count(*)::integer AS recorded_days,COALESCE(sum(working_minutes),0)::bigint AS working_minutes,
      COALESCE(sum(late_mins),0)::bigint AS late_mins,COALESCE(sum(early_mins),0)::bigint AS early_mins,
      COALESCE(sum(outside_shift_minutes),0)::bigint AS outside_shift_minutes,COALESCE(sum(overtime_minutes),0)::bigint AS overtime_minutes
      FROM attendance a WHERE ${where}`,values)).rows[0]};
    const {projection}=require('./attendance-import.repository');
    return {data:(await this.repo.pool.query(`SELECT ${projection},e.employee_code,e.full_name FROM attendance a JOIN employees e ON e.id=a.employee_id
      WHERE ${where} ORDER BY a.work_date DESC,a.id DESC LIMIT $5 OFFSET $6`,[...values,f.limit,f.offset])).rows,limit:f.limit,offset:f.offset};
  }
  async detail(user,id) {const actor=await this.repo.actor(this.repo.pool,user.id),row=await this.repo.find(this.repo.pool,R.id(id));if(!row)R.fail('NOT_FOUND','Attendance not found.',404);if(actor.role_name!=='HR'&&String(actor.employeeId)!==String(row.employee_id))R.fail('NOT_FOUND','Attendance not found.',404);return {data:row};}
  async logs(user,id,query) {await this.repo.actor(this.repo.pool,user.id,true);await this.detail(user,id);const f=this.filters(query);return {data:(await this.repo.pool.query('SELECT * FROM attendance_audit_logs WHERE attendance_id=$1 ORDER BY id DESC LIMIT $2 OFFSET $3',[id,f.limit,f.offset])).rows};}
  async mutate(user,id,body,action) {
    R.object(body,action==='UPDATE'?['check_in','check_out','expected_version','reason']:['expected_version','reason']);
    const reason=R.reason(body.reason);R.id(body.expected_version);
    return this.repo.transaction(async db=>{
      await this.repo.actor(db,user.id,true,true);
      const initial=await this.repo.find(db,R.id(id));if(!initial)R.fail('NOT_FOUND','Attendance not found.',404);
      await this.repo.lockKey(db,initial.employee_id,initial.work_date);
      const row=await this.repo.find(db,id,true);
      if(String(row.version)!==String(body.expected_version))R.fail('ATTENDANCE_CONFLICT','Record changed; reload before editing.',409);
      if(action==='UPDATE') {
        if(row.record_status!=='ACTIVE')R.fail('CANCELLED_RECORD','Restore this record before editing.',409);
        if(!row.schedule_snapshot)R.fail('LEGACY_RECORD','Legacy record has no schedule snapshot; reconcile it through import first.',409);
        if(body.check_in===undefined&&body.check_out===undefined)R.fail('VALIDATION_ERROR','Provide at least one timestamp.');
        const checkIn=body.check_in===undefined?row.check_in:R.timestamp(body.check_in), checkOut=body.check_out===undefined?row.check_out:R.timestamp(body.check_out);
        if(!R.candidates(checkIn,checkOut,row.schedule_snapshot).includes(row.work_date))R.fail('ATT-007','Timestamps do not match the original shift date.');
        if((Date.parse(checkOut)-Date.parse(checkIn))/R.MINUTE>R.policy(row.schedule_snapshot.attendance_policy).max_duration_minutes)R.fail('ATT-010','Duration exceeds maximum.');
        return {data:await this.repo.write(db,{...row,check_in:checkIn,check_out:checkOut,...R.calculate(row.work_date,checkIn,checkOut,row.schedule_snapshot)},row,user.id,reason)};
      }
      const target=action==='CANCEL'?'CANCEL':'ACTIVE';
      if(row.record_status===target)R.fail('INVALID_TRANSITION',`Record already ${target}.`,409);
      if(action==='RESTORE') {
        if(!row.schedule_snapshot||!row.check_in||!row.check_out)R.fail('LEGACY_RECORD','Restore requires a valid timestamp pair and schedule snapshot.',409);
        R.calculate(row.work_date,row.check_in,row.check_out,row.schedule_snapshot);
      }
      await db.query(`UPDATE attendance SET record_status=$2::varchar,cancellation_reason=$3,cancelled_by=$4,cancelled_at=CASE WHEN $2::varchar='CANCEL' THEN CURRENT_TIMESTAMP ELSE NULL END,
        version=version+1,updated_at=CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Ho_Chi_Minh' WHERE id=$1`,[id,target,action==='CANCEL'?reason:null,action==='CANCEL'?user.id:null]);
      const after=await this.repo.find(db,id);await this.repo.audit(db,user.id,action,row,after,reason);return {data:after};
    });
  }
}
module.exports={AttendanceImportService,batchId};
