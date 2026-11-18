const express=require('express');
const multer=require('multer');
const ExcelJS=require('exceljs');
const {createHash}=require('node:crypto');
const {AppError}=require('../../common/errors/app-error');
const {writeAudit}=require('../audit_logs/audit.repository');
const columns='id,user_id,name,start_date::text,end_date::text,description,status';
function fail(message,status=400){throw new AppError(status,message);}
function day(v){if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)||v.startsWith('0000-')||!Number.isFinite(Date.parse(v))||new Date(v).toISOString().slice(0,10)!==v)fail('Ngày phải hợp lệ và dùng YYYY-MM-DD.');return v;}
function todayVN(now=new Date()){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);}
function holidayId(value){if(!/^[1-9]\d{0,9}$/.test(String(value))||!Number.isSafeInteger(Number(value))||Number(value)>2147483647)fail('ID ngày lễ phải là số nguyên dương hợp lệ.');return Number(value);}
function patchInput(b){if(!b||typeof b!=='object'||Array.isArray(b)||!Object.keys(b).length||Object.keys(b).some(k=>!['name','start_date','end_date','description'].includes(k)))fail('Cập nhật chỉ nhận name, start_date, end_date, description và không được để body trống.');return b;}
function input(b){
 if(!b||typeof b!=='object'||Array.isArray(b)||Object.keys(b).some(k=>!['name','start_date','end_date','description'].includes(k)))fail('Chỉ nhận name, start_date, end_date, description. user_id lấy từ tài khoản HR.');
 if(typeof b.name!=='string'||!b.name.trim()||Array.from(b.name.trim()).length>150||/[\x00-\x1f]/.test(b.name))fail('Tên ngày lễ bắt buộc, tối đa 150 ký tự, không chứa ký tự điều khiển.');
 const start=day(b.start_date),end=day(b.end_date);
 if(end<start||(Date.parse(end)-Date.parse(start))/86400000>=366)fail('Khoảng ngày lễ phải từ 1 đến 366 ngày.');
 if(b.description!=null&&(typeof b.description!=='string'||b.description.length>4000||b.description.includes('\0')))fail('description tối đa 4000 ký tự.');
 return {name:b.name.trim(),start_date:start,end_date:end,description:b.description?.trim()||null};
}
async function actor(db,id){const a=(await db.query("SELECT u.id FROM users u JOIN role r ON r.id=u.role_id WHERE u.id=$1 AND u.status='ACTIVE' AND r.name='HR' FOR SHARE OF u,r",[id])).rows[0];if(!a)fail('Chỉ HR ACTIVE được quản lý ngày lễ.',403);return a;}
async function calendarLock(db,shared=false){await db.query(`SELECT pg_advisory_xact_lock${shared?'_shared':''}(hashtext('company-holidays'))`);}
async function workingWarnings(db,start,end){
 const rows=(await db.query(`SELECT a.id AS attendance_id,e.id AS employee_id,e.employee_code,e.full_name,e.employment_type,a.work_date::text,a.check_in,a.check_out,a.working_minutes
 FROM attendance a JOIN employees e ON e.id=a.employee_id WHERE a.record_status='ACTIVE' AND COALESCE(a.working_minutes,0)>0 AND a.check_in IS NOT NULL AND a.check_out>a.check_in
 AND a.check_in<($2::date+1)::timestamp AND a.check_out>$1::date::timestamp ORDER BY a.work_date,e.id`,[start,end])).rows;
 return rows.map(r=>({...r,code:r.employment_type==='PART_TIME'?'PART_TIME_HOLIDAY_WORK':'HOLIDAY_WORK',severity:'WARNING',message:r.employment_type==='PART_TIME'?'Có nhân viên part-time làm việc vào ngày lễ. HR cần kiểm tra lịch làm và chính sách áp dụng.':'Có giờ làm thực tế vào ngày lễ. HR cần kiểm tra chính sách áp dụng.'}));
}
async function workWarnings(db,employeeId,checkIn,checkOut){
 if(!checkIn||!checkOut)return [];
 const rows=(await db.query(`SELECT h.id,h.name,h.start_date::text,h.end_date::text,e.employment_type
 FROM holidays h JOIN employees e ON e.id=$1 WHERE h.status='ACTIVE'
 AND ($2::timestamptz AT TIME ZONE 'Asia/Ho_Chi_Minh')<(h.end_date+1)::timestamp
 AND ($3::timestamptz AT TIME ZONE 'Asia/Ho_Chi_Minh')>h.start_date::timestamp ORDER BY h.start_date,h.id`,[employeeId,checkIn,checkOut])).rows;
 return rows.map(h=>({code:h.employment_type==='PART_TIME'?'PART_TIME_HOLIDAY_WORK':'HOLIDAY_WORK',message:h.employment_type==='PART_TIME'?`Nhân viên part-time có giờ làm vào ngày lễ: ${h.name}. HR cần xác nhận.`:`Có giờ làm vào ngày lễ: ${h.name}. HR cần xác nhận.`,severity:'WARNING',requires_resolution:false,holiday_id:h.id,holiday_name:h.name}));
}
async function leaveCalendar(db,employeeId,start,end){
 const {rows}=await db.query(`WITH dates AS (SELECT d::date AS day FROM generate_series($2::date,$3::date,INTERVAL '1 day') d)
 SELECT count(*)::int AS calendar_days,count(*) FILTER(WHERE EXISTS(SELECT 1 FROM holidays h WHERE h.status='ACTIVE' AND dates.day BETWEEN h.start_date AND h.end_date))::int AS holiday_days,
 count(*) FILTER(WHERE extract(isodow FROM dates.day)::int=ANY(s.working_days) AND NOT EXISTS(SELECT 1 FROM holidays h WHERE h.status='ACTIVE' AND dates.day BETWEEN h.start_date AND h.end_date))::int AS working_days,
 bool_or(s.id IS NOT NULL) AS schedule_configured
 FROM dates LEFT JOIN employees e ON e.id=$1 LEFT JOIN work_schedules s ON s.id=e.work_schedule_id AND s.status='ACTIVE'`,[employeeId,start,end]);
 const r=rows[0];return {...r,working_days:r.schedule_configured?r.working_days:null,schedule_source:'EMPLOYEE_CURRENT',warnings:r.holiday_days?[{code:'HOLIDAY_WITHIN_LEAVE_PERIOD',message:'Khoảng nghỉ có ngày lễ; ngày lễ không được cộng vào số ngày làm việc nghỉ phép.'}]:[]};
}
async function parse(file){
 if(!file||!Buffer.isBuffer(file.buffer)||file.buffer.length>5*1024*1024||!file.originalname?.toLowerCase().endsWith('.xlsx'))fail('Upload một file .xlsx tối đa 5 MB bằng field file.');
 const wb=new ExcelJS.Workbook();try{await wb.xlsx.load(file.buffer);}catch{fail('File Excel không đọc được.');}
 const s=wb.worksheets[0],headers=['name','start_date','end_date','description'];
 if(wb.worksheets.length!==1||!s||s.rowCount>1001||s.columnCount<3||s.columnCount>4)fail('Dùng 1 sheet, tối đa 1000 dòng, các cột name,start_date,end_date,description (description tùy chọn).');
 const hs=s.getRow(1).values.slice(1);if(hs.some((h,i)=>h!==headers[i])||hs.length<3)fail('Header theo thứ tự: name,start_date,end_date,description.');
 const rows=[];s.eachRow((row,n)=>{if(n===1||!row.values.slice(1).some(x=>x!=null&&x!==''))return;const out={row:n};try{const b={};for(let i=0;i<hs.length;i++){let v=row.getCell(i+1).value;if(v instanceof Date&&hs[i].endsWith('_date'))v=Number.isFinite(v.getTime())&&v.toISOString().slice(11)==='00:00:00.000Z'?v.toISOString().slice(0,10):'';if(v!=null&&typeof v!=='string')fail('Chỉ nhập giá trị thuần; không dùng công thức, hyperlink hay ô phức hợp.');b[hs[i]]=v;}out.input=input(b);}catch(e){out.status='ERROR';out.message=e.message;}rows.push(out);});
 if(!rows.length)fail('File không có dữ liệu.');return {rows,fingerprint:createHash('sha256').update(file.buffer).digest('hex')};
}
class HolidayService {
 constructor(pool,{clock=()=>new Date()}={}){this.pool=pool;this.clock=clock;}
 async transaction(id,work,shared=false){const c=await this.pool.connect();try{await c.query('BEGIN');await c.query("SET LOCAL lock_timeout='5s'");await actor(c,id);await calendarLock(c,shared);const r=await work(c);await c.query('COMMIT');return r;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
 async inspect(c,rows,excludeId=null){
  const existing=(await c.query(`SELECT ${columns} FROM holidays WHERE status='ACTIVE' ORDER BY start_date,id`)).rows,accepted=[];
  for(const r of rows){if(!r.input)continue;const x=r.input;if(x.start_date<=todayVN(this.clock())){r.status='ERROR';r.message='Chỉ được thêm ngày lễ trong tương lai; start_date phải sau ngày hôm nay theo giờ Việt Nam.';continue;}const overlap=[...existing.filter(h=>h.id!==excludeId),...accepted].find(h=>h.start_date<=x.end_date&&h.end_date>=x.start_date);
   if(overlap){const exact=overlap.name===x.name&&overlap.start_date===x.start_date&&overlap.end_date===x.end_date&&(overlap.description||null)===x.description;r.status=exact?'DUPLICATE':'ERROR';r.message=exact?'Ngày lễ đã có; bỏ qua.':'Khoảng ngày trùng ngày lễ ACTIVE khác.';}
   else{r.status='VALID';accepted.push(x);}
   r.warnings=await workingWarnings(c,x.start_date,x.end_date);
  }return rows;
 }
 async insert(c,x,id){if(x.start_date<=todayVN(this.clock()))fail('Chỉ được thêm ngày lễ trong tương lai theo giờ Việt Nam.');const r=(await c.query(`INSERT INTO holidays(user_id,name,start_date,end_date,description,status) VALUES($1,$2,$3,$4,$5,'ACTIVE') RETURNING ${columns}`,[id,x.name,x.start_date,x.end_date,x.description])).rows[0];await writeAudit(c,{actorId:id,entityType:'holidays',entityId:r.id,action:'CREATE',newValue:r});return r;}
 async create(id,b){const x=input(b);return this.transaction(id,async c=>{const r=(await this.inspect(c,[{row:1,input:x}]))[0];if(r.status!=='VALID')fail(r.message,x.start_date<=todayVN(this.clock())?400:409);return {data:await this.insert(c,x,id),warnings:r.warnings};});}
 async import(id,file,confirm=false,fingerprint){await actor(this.pool,id);const parsed=await parse(file);if(confirm&&fingerprint!==parsed.fingerprint)fail('File đã thay đổi hoặc thiếu fingerprint của bước xem trước.',409);
  return this.transaction(id,async c=>{const rows=await this.inspect(c,parsed.rows),errors=rows.filter(r=>r.status==='ERROR').length;if(confirm&&errors){const e=new AppError(422,'File có lỗi; chưa lưu ngày lễ nào.');e.details={rows,fingerprint:parsed.fingerprint};throw e;}
   if(confirm)for(const r of rows)if(r.status==='VALID')r.data=await this.insert(c,r.input,id);
   return {mode:confirm?'CONFIRMED':'PREVIEW',fingerprint:parsed.fingerprint,total:rows.length,valid:rows.filter(r=>r.status==='VALID').length,skipped:rows.filter(r=>r.status==='DUPLICATE').length,failed:errors,inserted:confirm?rows.filter(r=>r.status==='VALID').length:0,rows};
  });
 }
 async find(c,value,lock=false){const id=holidayId(value),row=(await c.query(`SELECT ${columns} FROM holidays WHERE id=$1 ${lock?'FOR UPDATE':''}`,[id])).rows[0];if(!row)fail('Không tìm thấy ngày lễ.',404);return row;}
 async detail(actorId,id){holidayId(id);return this.transaction(actorId,async c=>{const row=await this.find(c,id);return {data:row,warnings:row.status==='ACTIVE'?await workingWarnings(c,row.start_date,row.end_date):[]};},true);}
 async update(actorId,id,body,partial=false){holidayId(id);if(partial)patchInput(body);else input(body);
  return this.transaction(actorId,async c=>{const before=await this.find(c,id,true);
   if(before.status!=='ACTIVE')fail('Chỉ được sửa ngày lễ ACTIVE.',409);
   if(before.start_date<=todayVN(this.clock()))fail('Không thể sửa ngày lễ đã bắt đầu hoặc đã kết thúc.',409);
   const next=input(partial?{name:before.name,start_date:before.start_date,end_date:before.end_date,description:before.description,...body}:body);
   const row=(await this.inspect(c,[{row:1,input:next}],before.id))[0];if(row.status!=='VALID')fail(row.message,row.status==='DUPLICATE'?409:(next.start_date<=todayVN(this.clock())?400:409));
   const after=(await c.query(`UPDATE holidays SET name=$2,start_date=$3,end_date=$4,description=$5 WHERE id=$1 RETURNING ${columns}`,[before.id,next.name,next.start_date,next.end_date,next.description])).rows[0];
   await writeAudit(c,{actorId,entityType:'holidays',entityId:after.id,action:'UPDATE',oldValue:before,newValue:after});return {data:after,warnings:row.warnings};
  });
 }
 async remove(actorId,id){holidayId(id);return this.transaction(actorId,async c=>{const before=await this.find(c,id,true);
  if(before.start_date<=todayVN(this.clock()))fail('Chỉ được xóa ngày lễ chưa đến ngày bắt đầu theo giờ Việt Nam.',409);
  if(before.status==='INACTIVE')return {data:before,already_inactive:true};
  const after=(await c.query(`UPDATE holidays SET status='INACTIVE' WHERE id=$1 RETURNING ${columns}`,[before.id])).rows[0];
  await writeAudit(c,{actorId,entityType:'holidays',entityId:after.id,action:'DELETE',oldValue:before,newValue:after});return {data:after};
 });}
 async list(id,query={}){
  if(!query||typeof query!=='object'||Object.keys(query).some(k=>!['status','from','to','limit','offset'].includes(k)))fail('Bộ lọc chỉ nhận status, from, to, limit, offset.');
  const status=query.status??'ACTIVE',from=query.from===undefined?null:day(query.from),to=query.to===undefined?null:day(query.to);
  const limit=query.limit===undefined?100:Number(query.limit),offset=query.offset===undefined?0:Number(query.offset);
  if(!['ACTIVE','INACTIVE','ALL'].includes(status)||from&&to&&from>to||!Number.isInteger(limit)||limit<1||limit>200||!Number.isSafeInteger(offset)||offset<0||offset>10000000||query.limit!==undefined&&!/^\d+$/.test(String(query.limit))||query.offset!==undefined&&!/^\d+$/.test(String(query.offset)))fail('Bộ lọc ngày/trạng thái/phân trang không hợp lệ.');
  return this.transaction(id,async c=>{const rows=(await c.query(`SELECT ${columns} FROM holidays WHERE ($1='ALL' OR status=$1) AND ($2::date IS NULL OR end_date>=$2::date) AND ($3::date IS NULL OR start_date<=$3::date) ORDER BY start_date,id LIMIT $4 OFFSET $5`,[status,from,to,limit,offset])).rows;
   for(const r of rows)r.warnings=r.status==='ACTIVE'?await workingWarnings(c,r.start_date,r.end_date):[];return {data:rows,limit,offset};
  },true);
 }

}
function createHolidayRouter({pool,authenticate,service=new HolidayService(pool)}){
 const router=express.Router(),upload=multer({storage:multer.memoryStorage(),limits:{fileSize:5*1024*1024,files:1,fields:2,parts:3}}).single('file');
 router.use(authenticate,(_req,res,next)=>{res.set('Cache-Control','no-store, private');res.vary('Authorization');next();});
 const run=fn=>async(req,res,next)=>{try{res.json(await fn(req));}catch(e){next(e);}};
 router.post('/import',async(req,_res,next)=>{try{await actor(pool,req.auth.userId);next();}catch(e){next(e);}},upload,run(req=>{if(Object.keys(req.body||{}).some(k=>!['confirm','fingerprint'].includes(k))||req.body.confirm!==undefined&&!['true','false'].includes(req.body.confirm))fail('Chỉ nhận file, confirm=true/false và fingerprint.');return service.import(req.auth.userId,req.file,req.body.confirm==='true',req.body.fingerprint);}));
 router.post('/',run(req=>service.create(req.auth.userId,req.body)));router.get('/',run(req=>service.list(req.auth.userId,req.query)));
 router.get('/:id',run(req=>service.detail(req.auth.userId,req.params.id)));
 router.put('/:id',run(req=>service.update(req.auth.userId,req.params.id,req.body,false)));
 router.patch('/:id',run(req=>service.update(req.auth.userId,req.params.id,req.body,true)));
 router.delete('/:id',run(req=>{if(req.body&&Object.keys(req.body).length)fail('DELETE không nhận body.');return service.remove(req.auth.userId,req.params.id);}));
 router.use((e,_req,res,next)=>{if(e instanceof multer.MulterError)return res.status(e.code==='LIMIT_FILE_SIZE'?413:400).json({message:'File không hợp lệ: '+e.code});if(e instanceof AppError)return res.status(e.statusCode).json({message:e.message,...(e.details?{details:e.details}:{})});next(e);});return router;
}
module.exports={HolidayService,createHolidayRouter,input,parse,columns,workingWarnings,workWarnings,leaveCalendar,calendarLock,todayVN,holidayId};
