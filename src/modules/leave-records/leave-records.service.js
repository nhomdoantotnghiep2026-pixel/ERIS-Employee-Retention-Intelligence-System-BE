const {leaveCalendar}=require('../holidays/holidays');
const V=require('./leave-records.validation');
const {lockEmployee,projection}=require('./leave-records.repository');
const {parse}=require('./leave-records.import');
class LeaveRecordsService {
 constructor(repo){this.repo=repo;}
 async create(user,body){const row=V.input(body);return this.repo.transaction(async db=>{const a=await this.repo.actor(db,user);await lockEmployee(db,row.employee_id);await this.repo.validate(db,row);const saved=await this.repo.insert(db,row,a);return {...saved,calendar:await leaveCalendar(db,row.employee_id,row.start_date,row.end_date)};});}
 async mutate(user,id,body,action='UPDATE'){id=V.id(id);const changes=action==='UPDATE'?V.input(body,true):{};return this.repo.transaction(async db=>{await this.repo.actor(db,user);let row=await this.repo.find(db,id);await lockEmployee(db,row.employee_id);row=await this.repo.find(db,id);
 if(action!=='RESTORE'&&(await db.query(`SELECT id FROM attendance WHERE employee_id=$1 AND work_date BETWEEN $2::date AND $3::date AND record_status='ACTIVE' AND attendance_status='ON_LEAVE'`,[row.employee_id,row.start_date,row.end_date])).rows.length)V.fail('DERIVED_ATTENDANCE_EXISTS','Cancel the related ON_LEAVE attendance records before changing or cancelling their leave source.',409);
 if(action==='UPDATE'&&row.record_status!=='ACTIVE'||action==='RESTORE'&&row.record_status!=='CANCEL'||action==='CANCEL'&&row.record_status!=='ACTIVE')V.fail('INVALID_TRANSITION','Invalid record status.',409);
 const merged=V.input({employee_id:row.employee_id,leave_type_id:row.leave_type_id,start_date:row.start_date,end_date:row.end_date,reason:row.reason,...changes});
 if(action!=='CANCEL')await this.repo.validate(db,merged,id);
 await db.query(`UPDATE employee_leave_records SET leave_type_id=$2,start_date=$3,end_date=$4,reason=$5,record_status=$6,updated_at=CURRENT_TIMESTAMP WHERE id=$1`,[id,merged.leave_type_id,merged.start_date,merged.end_date,merged.reason,action==='CANCEL'?'CANCEL':'ACTIVE']);const saved=await this.repo.find(db,id);return {...saved,calendar:await leaveCalendar(db,saved.employee_id,saved.start_date,saved.end_date)};});}
 async types(user){return this.repo.transaction(async db=>{await this.repo.actor(db,user,false);return {data:await this.repo.types(db)};});}
 async detail(user,id){return this.repo.transaction(async db=>{await this.repo.actor(db,user);const row=await this.repo.find(db,V.id(id));return {...row,calendar:await leaveCalendar(db,row.employee_id,row.start_date,row.end_date)};});}
 async list(user,q={},own=false,summary=false){
 const employee=q.employee_id===undefined?null:V.id(q.employee_id),from=q.from===undefined?null:V.date(q.from),to=q.to===undefined?null:V.date(q.to);
 if(from&&to&&from>to)V.fail('VALIDATION_ERROR','Invalid date range.');
 const status=q.record_status||'ACTIVE',limit=q.limit===undefined?50:V.id(q.limit),offset=q.offset===undefined?0:Number(q.offset);
 if(!['ACTIVE','CANCEL','ALL'].includes(status)||limit>200||!Number.isSafeInteger(offset)||offset<0)V.fail('VALIDATION_ERROR','Invalid filters.');
 return this.repo.transaction(async db=>{const a=await this.repo.actor(db,user,!own);if(own&&!a.employee_id)V.fail('FORBIDDEN','A linked employee is required.',403);
 const values=[own?a.employee_id:employee,from,to,summary?'ACTIVE':status];
 const where=`($1::int IS NULL OR l.employee_id=$1) AND ($2::date IS NULL OR l.end_date>=$2) AND ($3::date IS NULL OR l.start_date<=$3) AND ($4='ALL' OR l.record_status=$4)`;
 if(summary){const records=(await db.query(`SELECT l.employee_id,l.leave_type_id,GREATEST(l.start_date,COALESCE($2::date,l.start_date))::text AS range_start,LEAST(l.end_date,COALESCE($3::date,l.end_date))::text AS range_end FROM employee_leave_records l WHERE ${where}`,values)).rows,groups=new Map();
 for(const row of records){const c=await leaveCalendar(db,row.employee_id,row.range_start,row.range_end);
 const key=row.employee_id+':'+row.leave_type_id,g=groups.get(key)||{employee_id:row.employee_id,leave_type_id:row.leave_type_id,records:0,total_days:0,calendar_days:0,holiday_days:0,total_hours:null};g.records++;g.calendar_days+=c.calendar_days;g.holiday_days+=c.holiday_days;if(c.working_days===null||g.total_days===null)g.total_days=null;else g.total_days+=c.working_days;groups.set(key,g);}
 return {data:[...groups.values()],days_note:'total_days excludes ACTIVE company holidays and non-working weekdays using the current employee schedule; null when no ACTIVE schedule is configured. Historical assignments are not inferred.'};}

 return {data:(await db.query(`SELECT ${projection},e.employee_code,to_jsonb(t)->>'code' AS leave_type,t.name AS leave_type_name FROM employee_leave_records l JOIN employees e ON e.id=l.employee_id JOIN leave_types t ON t.id=l.leave_type_id WHERE ${where} ORDER BY l.start_date DESC,l.id DESC LIMIT $5 OFFSET $6`,[...values,limit,offset])).rows,limit,offset};});}
 async import(user,file,confirm=false,fingerprint){const parsed=await parse(file);if(confirm&&(!fingerprint||fingerprint!==parsed.fingerprint))V.fail('FILE_CHANGED','Resubmit the previewed file and its fingerprint.',409);
 return this.repo.transaction(async db=>{const actor=await this.repo.actor(db,user);const employees=(await db.query('SELECT id,employee_code FROM employees')).rows;const types=await this.repo.types(db);
 // Stable lock ordering prevents two multi-employee imports from deadlocking.
 if(confirm){const ids=[...new Set(parsed.rows.map(r=>employees.find(e=>e.employee_code===r.employee_code)?.id).filter(Boolean))].sort((a,b)=>a-b);for(const id of ids)await lockEmployee(db,id);}
 const rows=[],accepted=[],seen=new Set();for(const raw of parsed.rows){const out={...raw};try{
 if(raw.parse_error)V.fail('VALIDATION_ERROR',raw.parse_error);
 const employee=employees.find(e=>e.employee_code===raw.employee_code),type=types.find(t=>t.code===raw.leave_type);
 if(!employee)V.fail('EMPLOYEE_NOT_FOUND','Employee not found.');if(!type)V.fail('LEAVE_TYPE_NOT_FOUND','Leave Type not found.');
 const row=V.input({employee_id:employee.id,leave_type_id:type.id,start_date:raw.start_date,end_date:raw.end_date,reason:raw.reason});const key=JSON.stringify(row);out.calendar=await leaveCalendar(db,employee.id,row.start_date,row.end_date);
 if(seen.has(key)){out.status='DUPLICATE';out.action='SKIP';}else{
 seen.add(key);out.status=await this.repo.validate(db,row,null,true);
 if(out.status==='VALID'&&accepted.some(r=>r.employee_id===row.employee_id&&r.start_date<=row.end_date&&r.end_date>=row.start_date))V.fail('LEAVE_CONFLICT','Overlaps an earlier valid file row.',409);
 if(out.status==='VALID'){accepted.push(row);if(confirm)out.id=(await this.repo.insert(db,row,actor)).id;}else out.action='SKIP';}
 }catch(e){if(!e.statusCode)throw e;out.status=e.statusCode===409?'CONFLICT':'ERROR';out.code=e.code;out.message=e.message;if(e.conflicts)out.conflicts=e.conflicts;}rows.push(out);}
 const count=s=>rows.filter(r=>r.status===s).length;return confirm?{total_rows:rows.length,inserted:count('VALID'),skipped:count('DUPLICATE'),conflicted:count('CONFLICT'),failed:count('ERROR'),rows}:{fingerprint:parsed.fingerprint,summary:{total_rows:rows.length,valid:count('VALID'),duplicate:count('DUPLICATE'),conflict:count('CONFLICT'),error:count('ERROR')},rows};});}
}
module.exports={LeaveRecordsService};
