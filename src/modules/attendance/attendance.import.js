const ExcelJS = require('exceljs');
const multer = require('multer');
const { AppError } = require('../../common/errors/app-error');
const {validateAgainstSchedule}=require('./import-schedule.validation');
const HEADERS = ['employee_id','attendance_date','shift_type','attendance_status','login_timestamp','logout_timestamp','total_hours_worked','late_arrival_mins','early_exit_mins','overtime_hours','leave_type'];
const upload = multer({storage:multer.memoryStorage(),limits:{fileSize:5*1024*1024,files:1,fields:0}}).single('file');
function value(cell) {
 const v=cell.value;
 if(v && typeof v==='object' && !(v instanceof Date)) throw new Error('Formula, rich text and linked cells are not supported.');
 return typeof v==='string'?v.trim():v;
}
function date(v,timestamp=false) {
 if(v instanceof Date && Number.isFinite(v.getTime())) return date(v.toISOString().slice(0,timestamp?19:10).replace('T',' '),timestamp);
 if(typeof v!=='string') throw new Error('Use YYYY-MM-DD or YYYY-MM-DD HH:mm:ss (Vietnam local time).');
 const pattern=timestamp?/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/:/^\d{4}-\d{2}-\d{2}$/;
 const normalized=v.replace('T',' ');
 const instant=new Date(normalized.replace(' ','T')+(timestamp?'Z':'T00:00:00Z'));
 if(!pattern.test(v)||!Number.isFinite(instant.getTime())||instant.toISOString().slice(0,timestamp?19:10).replace('T',' ')!==normalized) throw new Error('Invalid calendar date/time.');
 return normalized;
}
async function parse(buffer) {
 const book=new ExcelJS.Workbook();
 try {await book.xlsx.load(buffer);} catch {throw new AppError(400,'Invalid XLSX workbook.');}
 if(book.worksheets.length!==1) throw new AppError(400,'Use exactly one worksheet.');
 const sheet=book.worksheets[0];
 if(sheet.rowCount>10001) throw new AppError(400,'Maximum 10000 attendance rows per file.');
 try {if(sheet.columnCount!==HEADERS.length||HEADERS.some((h,i)=>value(sheet.getRow(1).getCell(i+1))!==h)) throw new Error();}
 catch {throw new AppError(400,'Required headers in order: '+HEADERS.join(', '));}
 const rows=[];
 sheet.eachRow((row,n)=>{if(n===1)return; const errors=[]; const data={};
 HEADERS.forEach((h,i)=>{try{data[h]=value(row.getCell(i+1));}catch(e){errors.push({field:h,message:e.message});}});
 if(!Object.values(data).some(v=>v!==null&&v!==''&&v!==undefined)&&!errors.length)return;
 rows.push({row:n,data,errors});});
 if(!rows.length)throw new AppError(400,'Workbook has no attendance rows.');
 return rows;
}
function validate(row) {
 const d=row.data, errors=row.errors;
 const check=(field,fn)=>{try{fn();}catch(e){errors.push({field,message:e.message});}};
 check('employee_id',()=>{if(typeof d.employee_id!=='string'||!d.employee_id||d.employee_id.length>100)throw new Error('Employee code is required as text.');});
 check('shift_type',()=>{if(typeof d.shift_type!=='string'||!d.shift_type||d.shift_type.length>100)throw new Error('Shift type is required.');});
 check('attendance_date',()=>{d.attendance_date=date(d.attendance_date);if(d.attendance_date>new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Ho_Chi_Minh'}))throw new Error('Future attendance is not accepted.');});
 for(const key of ['login_timestamp','logout_timestamp'])check(key,()=>{d[key]=d[key]==null||d[key]===''?null:date(d[key],true);});
 for(const key of ['total_hours_worked','late_arrival_mins','early_exit_mins','overtime_hours'])check(key,()=>{
  const v=d[key];if(typeof v!=='number'||!Number.isFinite(v)||v<0||v>(key.endsWith('mins')?1440:24)|| (key.endsWith('mins')&&!Number.isInteger(v)))throw new Error('A non-negative numeric value is required (hours <=24, whole minutes <=1440).');
 });
 const absent=['ABSENT','ON_LEAVE','HOLIDAY'].includes(d.attendance_status);
 check('attendance_status',()=>{if(!['PRESENT','LATE','EARLY_LEAVE','LATE_EARLY_LEAVE','ABSENT','ON_LEAVE','HOLIDAY'].includes(d.attendance_status))throw new Error('Unsupported attendance status.');});
 check('leave_type',()=>{if(d.attendance_status==='ON_LEAVE'&&(typeof d.leave_type!=='string'||!d.leave_type))throw new Error('Leave type is required for ON_LEAVE.');if(d.attendance_status!=='ON_LEAVE'&&d.leave_type)throw new Error('Leave type is only allowed for ON_LEAVE.');if(d.leave_type&&d.leave_type.length>100)throw new Error('Maximum 100 characters.');});
 if(absent){if(d.login_timestamp||d.logout_timestamp||['total_hours_worked','overtime_hours','late_arrival_mins','early_exit_mins'].some(k=>d[k]!==0))errors.push({field:'attendance_status',message:'Non-working records require empty timestamps and zero hours/minutes.'});}
 else if(typeof d.login_timestamp!=='string'||typeof d.logout_timestamp!=='string'||d.logout_timestamp<=d.login_timestamp||d.login_timestamp.slice(0,10)!==d.attendance_date)errors.push({field:'login_timestamp',message:'Both timestamps required; login date must match attendance date and logout must follow login.'});
 else {const elapsed=(new Date(d.logout_timestamp.replace(' ','T')+'Z')-new Date(d.login_timestamp.replace(' ','T')+'Z'))/3600000;
 if(new Date(d.logout_timestamp.replace(' ','T')+'+07:00').getTime()>Date.now())errors.push({field:'logout_timestamp',message:'Logout must not be in the future.'});
 if(elapsed>24||d.total_hours_worked<=0||d.total_hours_worked>elapsed+1/60||d.overtime_hours>d.total_hours_worked)errors.push({field:'total_hours_worked',message:'Hours must be positive, within elapsed time (maximum 24h); overtime is included in total hours.'});
 if((d.late_arrival_mins>0&&!['LATE','LATE_EARLY_LEAVE'].includes(d.attendance_status))||(d.early_exit_mins>0&&!['EARLY_LEAVE','LATE_EARLY_LEAVE'].includes(d.attendance_status)))errors.push({field:'attendance_status',message:'Status must agree with late/early minutes.'});}
 return row;
}
async function processRows(rows,pool,actorId) {
 const keys=new Map(); rows.forEach(validate);
 for(const r of rows){const key=r.data.employee_id+'|'+r.data.attendance_date; const group=keys.get(key)||[];group.push(r);keys.set(key,group);}
 for(const group of keys.values())if(group.length>1)for(const r of group)r.errors.push({field:'attendance_date',message:'Duplicate employee/date in file.'});
 const perEmployee=new Map();
 for(const r of rows.filter(r=>!r.errors.length&&r.data.login_timestamp&&r.data.logout_timestamp)){
  const group=perEmployee.get(r.data.employee_id)||[];group.push(r);perEmployee.set(r.data.employee_id,group);
 }
 for(const group of perEmployee.values()){
  group.sort((a,b)=>a.data.login_timestamp.localeCompare(b.data.login_timestamp));
  let previous=null;
  for(const r of group){if(previous&&r.data.login_timestamp<previous.data.logout_timestamp){
   for(const target of [previous,r])target.errors.push({field:'login_timestamp',code:'OVERLAPPING_ATTENDANCE',message:'Attendance intervals overlap another row for this employee.'});
  }if(!previous||r.data.logout_timestamp>previous.data.logout_timestamp)previous=r;}
 }
 const client=await pool.connect();const results=[];
 try{await client.query('BEGIN');
 await client.query("SET LOCAL lock_timeout='5s'");
 await client.query("SET LOCAL statement_timeout='60s'");
 const actor=(await client.query("SELECT u.id FROM users u JOIN role r ON r.id=u.role_id WHERE u.id=$1 AND u.status='ACTIVE' AND r.name='HR' FOR SHARE OF u,r",[actorId])).rows[0];if(!actor)throw new AppError(403,'Active HR account required.');
 const schema=(await client.query("SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public' AND ((table_name='attendance' AND column_name IN ('late_mins','early_mins','leave_type')) OR (table_name='employees' AND column_name='work_schedule_id') OR (table_name='work_schedules' AND column_name='shift_type'))")).rows;
 if(schema.length!==5)throw new AppError(503,'Attendance import requires employees.work_schedule_id, work_schedules.shift_type and attendance late_mins/early_mins/leave_type. Check the configured database and migrations.');
 for(const row of rows){const d=row.data; if(!row.errors.length){
 const employees=(await client.query('SELECT id,hire_date::text,work_schedule_id FROM employees WHERE employee_code=$1 FOR UPDATE',[d.employee_id])).rows;
 if(employees.length!==1)row.errors.push({field:'employee_id',message:'Employee code not found or ambiguous.'});
 else if(d.attendance_date<employees[0].hire_date)row.errors.push({field:'attendance_date',message:'Attendance precedes hire date.'});
 const schedules=employees.length===1&&employees[0].work_schedule_id!=null?(await client.query('SELECT id,shift_type,status,start_time,end_time,break_start,break_end,working_days FROM work_schedules WHERE id=$1 FOR SHARE',[employees[0].work_schedule_id])).rows:[];
 if(schedules.length!==1)row.errors.push({field:'shift_type',message:'Employee has no valid work_schedule_id referencing work_schedules.'});
 else validateAgainstSchedule(row,schedules[0]);
 if(!row.errors.length){
 const conflict=(await client.query(`SELECT id FROM attendance WHERE employee_id=$1 AND work_date<>$2::date AND record_status='ACTIVE'
 AND check_in<$4::timestamp AND check_out>$3::timestamp LIMIT 1`,[employees[0].id,d.attendance_date,d.login_timestamp,d.logout_timestamp])).rows[0];
 if(conflict){row.errors.push({field:'login_timestamp',code:'OVERLAPPING_ATTENDANCE',message:'Time interval overlaps stored attendance on another date.'});results.push({row:row.row,status:'FAILED',employeeCode:d.employee_id,errors:row.errors,warnings:row.warnings||[]});continue;}
 const inserted=(await client.query(`INSERT INTO attendance(employee_id,work_date,check_in,check_out,working_minutes,overtime_minutes,late_mins,early_mins,leave_type,attendance_status,record_status)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'ACTIVE') ON CONFLICT DO NOTHING RETURNING id`,[employees[0].id,d.attendance_date,d.login_timestamp,d.logout_timestamp,Math.round(d.total_hours_worked*60),Math.round(d.overtime_hours*60),d.late_arrival_mins,d.early_exit_mins,d.leave_type||null,d.attendance_status])).rows[0];
 if(!inserted)row.errors.push({field:'attendance_date',message:'Attendance already exists for this employee/date.'});
 else {await client.query("INSERT INTO audit_logs(user_id,entity_type,entity_id,action,new_value) VALUES($1,'attendance',$2,'CREATE',$3::jsonb)",[actorId,inserted.id,JSON.stringify({source:'XLSX_IMPORT',row:row.row,...d,validatedScheduleId:schedules[0].id,warnings:row.warnings||[]})]);results.push({row:row.row,status:'CREATED',employeeCode:d.employee_id,id:inserted.id,warnings:row.warnings||[]});continue;}
 }}results.push({row:row.row,status:'FAILED',employeeCode:d.employee_id,errors:row.errors,warnings:row.warnings||[]});}
 await client.query('COMMIT');return {total:results.length,created:results.filter(r=>r.status==='CREATED').length,failed:results.filter(r=>r.status==='FAILED').length,results};
 }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}
function registerImport(router,requireHr,pool){router.post('/import',requireHr,(req,res,next)=>upload(req,res,async error=>{try{
 if(error)throw new AppError(error.code==='LIMIT_FILE_SIZE'?413:400,'Invalid file upload: '+error.code);
 if(!req.file||!req.file.originalname.toLowerCase().endsWith('.xlsx'))throw new AppError(400,'Upload one .xlsx file using field file.');
 res.json(await processRows(await parse(req.file.buffer),pool,req.auth.userId));
 }catch(e){next(e);}}));}
module.exports={HEADERS,parse,validate,processRows,registerImport};
