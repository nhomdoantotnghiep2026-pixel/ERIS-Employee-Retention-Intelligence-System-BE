const { readSummary, readRecords, readLogs, cancelRecord } = require('../repositories/attendance-read.repository');
const {shiftTypeKey}=require('../../../common/validation/shift-type');
const {workWarnings,calendarLock}=require('../../holidays/holidays.service');
const { assertNoLeave, lockEmployee } = require('../../leave-records/leave-records.repository');
const jwt=require('jsonwebtoken');
const { createHash } = require('node:crypto');
const R = require('../helpers/attendance-import.rules');
const { parseWorkbook, errorsWorkbook } = require('../helpers/attendance-import.excel');
const issue=(code,message,severity='ERROR',requires_resolution=false)=>({code,message,severity,requires_resolution});
const same=(row,current)=>!!current && current.record_status==='ACTIVE' &&
  current.attendance_status===row.attendance_status && current.check_in===row.check_in && current.check_out===row.check_out && current.work_schedule_id===row.work_schedule_id &&
  ['working_minutes','overtime_minutes','late_mins','early_mins'].every(k=>Number(current[k])===Number(row[k]));
const existingToken=current=>current ? {id:current.id,fingerprint:R.hash(current)} : null;
class AttendanceImportService {
  constructor(repository,{previewSecret=process.env.JWT_SECRET,clock=()=>new Date()}={}) { this.repo=repository;this.previewSecret=previewSecret;this.clock=clock; }
  async build(db, input, choices={}, complete=false) {
    await calendarLock(db,true);
    const refs=await this.repo.references(db), employees=new Map(refs.employees.map(e=>[e.employee_code,e]));
    const rows=[],now=this.clock().getTime();
    const incompleteDays=new Set(input.filter(row=>row.work_date&&Boolean(row.check_in)!==Boolean(row.check_out))
      .map(row=>`${row.employee_code}:${row.work_date}`));
    const emptyRows=input.filter(row=>row.work_date&&!row.check_in&&!row.check_out);
    const dates=emptyRows.map(row=>row.work_date).sort();
    const calendar=dates.length ? await this.repo.calendarSources(db,dates[0],dates.at(-1),
      [...new Set(emptyRows.map(row=>employees.get(row.employee_code)?.id).filter(Boolean))]) : {holidays:[],leaves:[]};
    for(const source of input) {
      const row={...source,issues:[...(source.parse_issues||[])],action:'BLOCKED',validation_status:'VALID'}, choice=choices[source.excel_row]||{};
      const employee=employees.get(row.employee_code), schedule=refs.schedules.find(s=>s.id===employee?.work_schedule_id);
      if(employee&&!schedule) row.issues.push(issue('ATT-016','Employee profile has no valid work schedule reference. Import the profile with a valid shift_type first.'));
      if(schedule&&shiftTypeKey(schedule.shift_type)!==shiftTypeKey(row.shift_type)) row.issues.push(issue('ATT-017','File shift_type does not match the employee assigned schedule.'));
      if(!employee) row.issues.push(issue('ATT-003','Employee code does not exist.'));
      if(schedule && schedule.status!=='ACTIVE') row.issues.push(issue('ATT-004','Shift type does not identify an active schedule.'));
      if(employee) { row.employee_id=employee.id; row.full_name=employee.full_name; if(row.employee_name && row.employee_name.normalize('NFC')!==employee.full_name.normalize('NFC'))row.issues.push(issue('ATT-009','Employee name differs from the employee profile.','WARNING')); }
      if(schedule) { row.work_schedule_id=schedule.id; row.schedule_snapshot=R.scheduleSnapshot(schedule); }
      if(!row.check_in&&!row.check_out) {
        row.validation_status='NO_DATA';
        if(row.work_date&&!row.issues.some(i=>i.severity==='ERROR')) {
          try {
            if(!employee.hire_date||row.work_date<employee.hire_date)R.fail('ATT-019','Attendance must be on or after the employee hire date.');
            const covers=source=>source.start_date<=row.work_date&&source.end_date>=row.work_date;
            const holidays=calendar.holidays.filter(covers);
            const leaves=calendar.leaves.filter(l=>l.employee_id===employee.id&&covers(l));
            const status=R.classifyNoPunch(row.work_date,schedule,now,{holiday:holidays.length,leave:leaves.length,
              complete:complete&&!incompleteDays.has(`${row.employee_code}:${row.work_date}`)});
            if(status) Object.assign(row,{attendance_status:status,check_in:null,check_out:null,working_minutes:0,
              late_mins:0,early_mins:0,overtime_minutes:0,derived_source:{
                holiday_ids:holidays.map(h=>h.id),leave_record_ids:status==='ON_LEAVE'?leaves.map(l=>l.id):[]}});
          } catch(e) { if(!e.code)throw e;row.issues.push(issue(e.code,e.message)); }
        }
        if(!row.attendance_status) row.issues.push(issue('ATT-015','No punches. A work date, completed shift and source or completeness confirmation are needed.','INFO'));
      }
      else if(!row.check_in||!row.check_out) { row.validation_status='INCOMPLETE';row.issues.push(issue('ATT-014','Both check_in and check_out are required.','INFO')); }
      else if(Date.parse(row.check_out)<=Date.parse(row.check_in))row.issues.push(issue('ATT-006','check_out must be after check_in.'));
      if(row.check_in&&row.check_out&&(Date.parse(row.check_in)>now||Date.parse(row.check_out)>now))row.issues.push(issue('ATT-018','The attendance date or time has not occurred yet. Import only attendance up to the current time in Vietnam.'));
      if(!row.issues.some(i=>i.severity==='ERROR') && row.check_in && row.check_out) {
        const duration=(Date.parse(row.check_out)-Date.parse(row.check_in))/R.MINUTE, p=R.policy(schedule.attendance_policy);
        if(duration>p.max_duration_minutes)row.issues.push(issue('ATT-010','Duration exceeds the configured maximum.'));
        else if(duration>p.unusual_duration_minutes)row.issues.push(issue('ATT-010','Unusually long attendance duration.','WARNING'));
        try {
          row.candidates=R.candidates(row.check_in,row.check_out,schedule);
          if(!row.candidates.length)row.issues.push(issue('ATT-007','No shift candidate matches the configured time windows.'));
          else if(row.candidates.length>1&&!row.work_date&&!choice.work_date)row.issues.push(issue('ATT-008','Select one shift date before confirming.','WARNING',true));
          else {
            row.work_date=row.work_date || choice.work_date || row.candidates[0];
            if(!row.candidates.includes(row.work_date))R.fail('ATT-007','Selected shift date is not a matching candidate.');
            if(!employee.hire_date||row.work_date<employee.hire_date||row.check_in.slice(0,10)<employee.hire_date)R.fail('ATT-019','Attendance must be on or after the employee hire date.');
            Object.assign(row,R.calculate(row.work_date,row.check_in,row.check_out,schedule));
            if(row.working_minutes<=0)R.fail('ATT-022','The interval contains no working time after excluding the shift break.');
            if(row.late_mins>0)row.issues.push(issue('ATT-023',`Check-in is ${row.late_mins} minutes after the assigned shift start.`,'WARNING'));
            if(row.early_mins>0)row.issues.push(issue('ATT-024',`Check-out is ${row.early_mins} minutes before the assigned shift end.`,'WARNING'));
            if(row.outside_shift_minutes>row.overtime_minutes)row.issues.push(issue('ATT-020','Early arrival outside the shift is not counted as overtime.','WARNING'));
            if(!(schedule.working_days||[]).includes(new Date(row.work_date+'T00:00:00Z').getUTCDay()||7))row.issues.push(issue('ATT-011','Attendance is outside the schedule working days.','WARNING'));
            row.issues.push(...await workWarnings(db,employee.id,row.check_in,row.check_out));
            await assertNoLeave(db,employee.id,row.work_date);
            const current=await this.repo.current(db,employee.id,row.work_date);
            row.previous=current;
            const overlaps=await this.repo.overlapping(db,employee.id,row.check_in,row.check_out);
            if(overlaps.some(a=>String(a.id)!==String(current?.id)))row.issues.push(issue('ATT-021','Time interval overlaps another active attendance record.'));
          }
        }catch(e){ if(!e.code)throw e;row.issues.push(issue(e.code,e.message)); }
      }
      if(row.attendance_status&&!row.issues.some(i=>i.severity==='ERROR')) {
        const current=Object.hasOwn(row,'previous')?row.previous:await this.repo.current(db,row.employee_id,row.work_date);
        row.existing=existingToken(current);row.previous=current;
        row.action=!current?'INSERT':same(row,current)?'SKIP':'CONFLICT';
        if(row.action==='CONFLICT')row.issues.push(issue('ATT-012','Cancel the existing ACTIVE attendance before importing a replacement.'));
        if(row.action==='SKIP')row.issues.push(issue('ATT-012','Identical active record already exists; this row will be skipped.','INFO'));
        if(current&&!row.check_in&&(current.check_in||current.check_out||Number(current.working_minutes)>0||Number(current.overtime_minutes)>0))
          row.issues.push(issue('ATT-025','An empty row cannot replace actual attendance.'));
      }
      if(row.issues.some(i=>i.severity==='ERROR')) { row.validation_status='ERROR';if(row.action!=='CONFLICT')row.action='BLOCKED'; }
      else if(row.attendance_status) row.validation_status=row.issues.some(i=>i.severity==='WARNING')?'WARNING':row.action==='SKIP'?'DUPLICATE':'VALID';
      if(choice.exclude) {row.excluded=true;row.action='SKIP';}
      rows.push(row);
    }
    const groups=new Map();
    for(const row of rows.filter(r=>r.attendance_status&&!r.excluded&&r.validation_status!=='ERROR')) { const key=`${row.employee_id}:${row.work_date}`;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row); }
    for(const group of groups.values()) if(group.length>1) {
      const first=group[0], identical=group.every(r=>r.check_in===first.check_in&&r.check_out===first.check_out&&r.attendance_status===first.attendance_status&&R.hash(r.schedule_snapshot)===R.hash(first.schedule_snapshot));
      for(const row of group.slice(identical?1:0)) {
        row.issues.push(issue('ATT-013',identical?'Identical row repeated in this file.':'Different rows target the same employee/date; exclude all but one.','INFO',!identical));
        row.validation_status='DUPLICATE';row.action=identical?'SKIP':'BLOCKED';row.file_duplicate=identical;
      }
    }
    const intervals=rows.filter(r=>!r.excluded&&r.check_in&&r.check_out&&r.validation_status!=='ERROR'&&!r.file_duplicate).sort((a,b)=>a.employee_id-b.employee_id||Date.parse(a.check_in)-Date.parse(b.check_in));
    let previous;for(const row of intervals){if(previous&&previous.employee_id===row.employee_id&&Date.parse(row.check_in)<Date.parse(previous.check_out)){for(const item of [previous,row]){item.issues.push(issue('ATT-021','Time interval overlaps another included file row.'));item.validation_status='ERROR';item.action='BLOCKED';}}if(!previous||previous.employee_id!==row.employee_id||Date.parse(row.check_out)>Date.parse(previous.check_out))previous=row;}
    return rows;
  }
  state(rows) { return rows.some(r=>!r.excluded&&(r.validation_status==='ERROR'||r.issues.some(i=>i.requires_resolution)))?'PREVIEWED':'READY'; }
  choices(input,source) {
    if(input===undefined)return {};
    if(!Array.isArray(input)||input.length>10000)R.fail('VALIDATION_ERROR','choices must be an array of at most 10000 row decisions.');
    const known=new Set(source.map(r=>r.excel_row)),result={};
    for(const choice of input){R.object(choice,['excel_row','work_date','exclude']);if(!Number.isInteger(choice.excel_row)||!known.has(choice.excel_row)||result[choice.excel_row])R.fail('VALIDATION_ERROR','Unknown or repeated excel_row in choices.');
      if(choice.work_date!==undefined)R.date(choice.work_date);
      if(choice.exclude!==undefined&&typeof choice.exclude!=='boolean')R.fail('VALIDATION_ERROR','exclude must be boolean.');
      result[choice.excel_row]={...(choice.work_date?{work_date:choice.work_date}:{}),exclude:!!choice.exclude};
    }return result;
  }
  proof(user,file,rows,choices) {
    if(typeof this.previewSecret!=='string'||this.previewSecret.length<24)R.fail('PREVIEW_UNAVAILABLE','Preview signing key is not configured.',503);
    return jwt.sign({purpose:'ATTENDANCE_PREVIEW',fileHash:createHash('sha256').update(file.buffer).digest('hex'),viewHash:R.hash(rows),choicesHash:R.hash(choices)},this.previewSecret,{algorithm:'HS256',issuer:'eris-attendance',subject:String(user.id),expiresIn:'30m'});
  }
  verify(user,file,token,choices) {
    if(typeof token!=='string'||token.length>4096||typeof this.previewSecret!=='string'||this.previewSecret.length<24)R.fail('INVALID_PREVIEW','Preview again before confirming.',409);
    let data;try{data=jwt.verify(token,this.previewSecret,{algorithms:['HS256'],issuer:'eris-attendance',subject:String(user.id)});}catch{R.fail('INVALID_PREVIEW','Preview is invalid or expired; preview the file again.',409);}
    if(data.purpose!=='ATTENDANCE_PREVIEW'||data.fileHash!==createHash('sha256').update(file.buffer).digest('hex')||data.choicesHash!==R.hash(choices))R.fail('STALE_PREVIEW','File or row choices changed; preview again.',409);
    return data;
  }
  async preview(user,file,body={}) {
    await this.repo.actor(this.repo.pool,user.id,true);
    R.object(body,['choices','confirm_complete']);const complete=this.completeness(body);
    const input=await parseWorkbook(file),choices=this.choices(body.choices,input);
    return this.repo.transaction(async db=>{
      await this.repo.actor(db,user.id,true,true);
      const rows=await this.build(db,input,choices,complete);
      for(const row of rows)row.selected_work_date=choices[row.excel_row]?.work_date;
      return {status:this.state(rows),rows,preview_token:this.proof(user,file,rows,{choices,complete}),expires_in_seconds:1800};
    });
  }
  async confirm(user,file,body={}) {
    await this.repo.actor(this.repo.pool,user.id,true);
    R.object(body,['preview_token','choices','confirm_warnings','duplicate_strategy','confirm_complete','skip_invalid']);
    const complete=this.completeness(body);
    if(body.skip_invalid!==undefined&&typeof body.skip_invalid!=='boolean')R.fail('VALIDATION_ERROR','skip_invalid must be boolean.');
    if(body.duplicate_strategy!==undefined&&body.duplicate_strategy!=='SKIP')R.fail('VALIDATION_ERROR','Only SKIP duplicate strategy is supported.');
    if(body.confirm_warnings!==undefined&&typeof body.confirm_warnings!=='boolean')R.fail('VALIDATION_ERROR','confirm_warnings must be boolean.');
    const input=await parseWorkbook(file),choices=this.choices(body.choices,input),proof=this.verify(user,file,body.preview_token,{choices,complete});
    return this.repo.transaction(async db=>{
      await this.repo.actor(db,user.id,true,true);await calendarLock(db,true);
      const refs=await this.repo.references(db),codes=new Set(input.map(r=>r.employee_code));
      const ids=[...new Set(refs.employees.filter(e=>codes.has(e.employee_code)).map(e=>e.id))].sort((a,b)=>a-b);
      for(const id of ids){await lockEmployee(db,id);await db.query('SELECT id FROM employees WHERE id=$1 FOR SHARE',[id]);}
      await db.query('SELECT id FROM work_schedules ORDER BY id FOR SHARE');
      const rows=await this.build(db,input,choices,complete);
      for(const row of rows)row.selected_work_date=choices[row.excel_row]?.work_date;
      if(R.hash(rows)!==proof.viewHash)R.fail('STALE_PREVIEW','Attendance, employee, schedule, leave or holiday data changed; preview again.',409);
      const candidates=rows.filter(r=>!r.excluded&&!['NO_DATA','INCOMPLETE'].includes(r.validation_status));
      const invalid=row=>row.validation_status==='ERROR'||row.issues.some(i=>i.severity==='ERROR'||i.requires_resolution);
      const included=body.skip_invalid?candidates.filter(row=>!invalid(row)):candidates;
      if(body.skip_invalid&&!included.some(row=>row.action==='INSERT'))R.fail('NO_VALID_ROWS','No valid attendance rows are available to save.',409);
      if(included.some(r=>r.validation_status==='ERROR'||r.issues.some(i=>i.requires_resolution)))R.fail('UNRESOLVED_ROWS','Resolve or exclude invalid rows before confirming.',409);
      if(included.some(r=>r.issues.some(i=>i.severity==='WARNING'))&&!body.confirm_warnings)R.fail('WARNINGS_UNCONFIRMED','HR must acknowledge preview warnings.',409);
      const result={status:'CONFIRMED',inserted:0,skipped:0,skipped_invalid:body.skip_invalid?candidates.filter(invalid).length:0,excluded:rows.length-included.length,rows:[]};
      for(const row of [...included].sort((a,b)=>a.employee_id-b.employee_id||a.work_date.localeCompare(b.work_date)||a.excel_row-b.excel_row)){
        if(row.file_duplicate){result.skipped++;result.rows.push({excel_row:row.excel_row,action:'SKIP'});continue;}
        await this.repo.lockKey(db,row.employee_id,row.work_date);
        const current=await this.repo.current(db,row.employee_id,row.work_date,true);
        if(R.hash(existingToken(current))!==R.hash(row.existing||null))R.fail('STALE_PREVIEW','Attendance changed; preview again.',409);
        if(row.action==='SKIP'){result.skipped++;result.rows.push({excel_row:row.excel_row,action:'SKIP'});continue;}
        if(current)R.fail('ATTENDANCE_CONFLICT','Cancel the existing ACTIVE attendance first.',409);
        const saved=await this.repo.write(db,row,null,user.id);
        result.inserted++;result.rows.push({excel_row:row.excel_row,action:'INSERT',attendance_id:saved.id,warnings:row.issues.filter(i=>i.severity==='WARNING')});
      }return result;
    });
  }
  completeness(body) {
    if(body.confirm_complete!==undefined&&typeof body.confirm_complete!=='boolean')R.fail('VALIDATION_ERROR','confirm_complete must be boolean.');
    return body.confirm_complete===true;
  }
  async errors(user,file,body={}){return errorsWorkbook((await this.preview(user,file,body)).rows);}

  filters(query={}) {
    const limit=query.limit===undefined?50:Number(query.limit),offset=query.offset===undefined?0:Number(query.offset);
    if(!Number.isInteger(limit)||limit<1||limit>200||!Number.isInteger(offset)||offset<0||offset>10000000)R.fail('VALIDATION_ERROR','Invalid pagination.');
    const from=query.from?R.date(query.from):null,to=query.to?R.date(query.to):null;
    if(from&&to&&from>to)R.fail('VALIDATION_ERROR','from must be on or before to.');
    const employeeId=query.employee_id?R.id(query.employee_id):null;
    if(employeeId&&BigInt(employeeId)>2147483647n)R.fail('VALIDATION_ERROR','employee_id is out of range.');
    return {limit,offset,from,to,employeeId};
  }
  async list(user,query={},own=false,summary=false) {
    const actor=await this.repo.actor(this.repo.pool,user.id),f=this.filters(query);
    if(own||actor.role_name!=='HR') {if(!actor.employeeId)R.fail('FORBIDDEN','A linked employee profile is required.',403);f.employeeId=actor.employeeId;}
    if(!own&&!summary&&actor.role_name!=='HR')R.fail('FORBIDDEN','Use /attendance/me to view your records.',403);
    const where=`($1::integer IS NULL OR a.employee_id=$1) AND ($2::date IS NULL OR a.work_date>=$2) AND ($3::date IS NULL OR a.work_date<=$3)
      AND a.record_status='ACTIVE'`;
    const values=[f.employeeId,f.from,f.to];
    if(summary)return {data:await readSummary(this.repo.pool, where, values)};
    const data=await readRecords(this.repo.pool, where, values, f);
    if(actor.role_name==='HR')for(const row of data)row.holiday_warnings=row.record_status==='ACTIVE'?await workWarnings(this.repo.pool,row.employee_id,row.check_in,row.check_out):[];
    return {data,limit:f.limit,offset:f.offset};
  }
  async detail(user,id) {const actor=await this.repo.actor(this.repo.pool,user.id),row=await this.repo.find(this.repo.pool,R.id(id));if(!row||row.record_status!=='ACTIVE')R.fail('NOT_FOUND','Attendance not found.',404);if(actor.role_name!=='HR'&&String(actor.employeeId)!==String(row.employee_id))R.fail('NOT_FOUND','Attendance not found.',404);if(actor.role_name==='HR')row.holiday_warnings=await workWarnings(this.repo.pool,row.employee_id,row.check_in,row.check_out);return {data:row};}
  async cancellations(user,query={},id=null) {
    await this.repo.actor(this.repo.pool,user.id,true);
    const filters=this.filters(query);
    const rows=await this.repo.cancellations(this.repo.pool,filters,id===null?null:R.id(id));
    if(id===null)return {data:rows,limit:filters.limit,offset:filters.offset};
    if(!rows.length)R.fail('NOT_FOUND','Cancelled attendance not found.',404);
    return {data:rows[0]};
  }
  async logs(user,id,query) {await this.repo.actor(this.repo.pool,user.id,true);await this.detail(user,id);const f=this.filters(query);return {data:await readLogs(this.repo.pool, id, f)};}
  async cancel(user,id,body) {
    R.object(body,['reason']);
    const reason=R.reason(body.reason),attendanceId=R.id(id);
    return this.repo.transaction(async db=>{
      await this.repo.actor(db,user.id,true,true);
      const initial=await this.repo.find(db,attendanceId);
      if(!initial)R.fail('NOT_FOUND','Attendance not found.',404);
      await this.repo.lockKey(db,initial.employee_id,initial.work_date);
      const row=await this.repo.find(db,attendanceId,true);
      if(!row)R.fail('NOT_FOUND','Attendance not found.',404);
      if(row.record_status!=='ACTIVE')R.fail('INVALID_TRANSITION','Only ACTIVE attendance can be cancelled.',409);
      await cancelRecord(db,attendanceId,reason,user.id);
      const after=await this.repo.find(db,attendanceId);
      await this.repo.audit(db,user.id,'CANCEL',row,after,reason);
      return {data:after};
    });
  }
}
module.exports={AttendanceImportService};
