const test=require('node:test'),assert=require('node:assert/strict'),ExcelJS=require('exceljs');
const {HolidayService,createHolidayRouter,input,parse,workWarnings,leaveCalendar}=require('../src/modules/holidays/holidays');
async function file(rows,headers=['name','start_date','end_date','description']){const w=new ExcelJS.Workbook(),s=w.addWorksheet('Holidays');s.addRow(headers);rows.forEach(r=>s.addRow(r));return {originalname:'holidays.xlsx',buffer:Buffer.from(await w.xlsx.writeBuffer())};}
test('holiday validation rejects identity override, invalid dates, reversed ranges and excessive length',()=>{
 const good={name:'Company day',start_date:'2026-11-18',end_date:'2026-11-18'};assert.equal(input(good).description,null);
 for(const b of [{...good,user_id:2},{...good,start_date:'2026-02-30'},{...good,end_date:'2026-11-17'},{...good,end_date:'2028-01-01'},{...good,name:''}])assert.throws(()=>input(b),e=>e.statusCode===400);
});
test('XLSX parser reports row errors, rejects formulas/headers and accepts date cells',async()=>{
 const p=await parse(await file([['Day',new Date('2026-11-18T00:00:00Z'),'2026-11-18',''],['Bad','2026-02-30','2026-11-18',''],[{formula:'1+1'},'2026-11-18','2026-11-18','']]));assert.equal(p.rows[0].input.start_date,'2026-11-18');assert.equal(p.rows[1].status,'ERROR');assert.equal(p.rows[2].status,'ERROR');
 await assert.rejects(parse(await file([['x','2026-11-18','2026-11-18']],['user_id','start_date','end_date'])),e=>e.statusCode===400);
});
test('TEMP PostgreSQL: HR API, preview/confirm/idempotency, calendar and part-time warnings without public writes',async()=>{
 const {databasePool:p}=require('../src/config/database');const c=await p.connect();let server;
 try{
 await c.query(`CREATE TEMP TABLE role(id int PRIMARY KEY,name text);CREATE TEMP TABLE users(id int PRIMARY KEY,role_id int,status text);INSERT INTO role VALUES(1,'HR'),(2,'EMPLOYEE');INSERT INTO users VALUES(1,1,'ACTIVE'),(2,2,'ACTIVE');
 CREATE TEMP TABLE holidays(id int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,user_id int NOT NULL REFERENCES users(id),name varchar(150) NOT NULL,start_date date NOT NULL,end_date date NOT NULL,description text,status varchar(20) NOT NULL DEFAULT 'ACTIVE',CHECK(end_date>=start_date));
 CREATE TEMP TABLE employees(id int PRIMARY KEY,employee_code text,full_name text,employment_type text,work_schedule_id int,hire_date text DEFAULT '2026-01-01');
 CREATE TEMP TABLE work_schedules(id int PRIMARY KEY,working_days int[],status text,shift_type text,start_time time,end_time time,break_start time,break_end time,attendance_policy jsonb);
 INSERT INTO work_schedules VALUES(1,ARRAY[1,2,3,4,5],'ACTIVE','DAY','08:00','17:00','12:00','13:00','{}');
 INSERT INTO employees VALUES(10,'PT010','Part Time','PART_TIME',1),(11,'FT011','Full Time','FULL_TIME',1),(12,'NO012','No Schedule','PART_TIME',NULL);
 CREATE TEMP TABLE attendance(id int PRIMARY KEY,employee_id int,work_date date,check_in timestamp,check_out timestamp,working_minutes int,record_status text);
 INSERT INTO attendance VALUES(1,10,'2026-11-18','2026-11-18 08:00','2026-11-18 17:00',480,'ACTIVE'),(2,11,'2026-11-18','2026-11-18 08:00','2026-11-18 17:00',480,'ACTIVE'),(3,10,'2026-11-17','2026-11-17 22:00','2026-11-18 06:00',480,'ACTIVE'),(4,10,'2026-11-18','2026-11-18 08:00','2026-11-18 17:00',480,'CANCEL');
 CREATE TEMP TABLE employee_leave_records(id int,employee_id int,start_date date,end_date date,record_status text);
 CREATE TEMP TABLE audit_logs(user_id int,entity_type text,entity_id int,action text,old_value jsonb,new_value jsonb);`);
 const db={query:(...a)=>c.query(...a)},pool={query:db.query,connect:async()=>({...db,release(){}})},service=new HolidayService(pool,{clock:()=>new Date('2026-11-15T05:00:00Z')});
 const created=await service.create(1,{name:'Company day',start_date:'2026-11-18',end_date:'2026-11-18'});
 assert.equal(created.data.user_id,1);assert.equal(created.warnings.filter(w=>w.code==='PART_TIME_HOLIDAY_WORK').length,2);assert.equal(created.warnings.length,3);
 await assert.rejects(service.create(2,{name:'No permission',start_date:'2026-11-19',end_date:'2026-11-19'}),e=>e.statusCode===403);
 await assert.rejects(service.create(1,{name:'Overlap',start_date:'2026-11-17',end_date:'2026-11-18'}),e=>e.statusCode===409);
 const night=await workWarnings(db,10,'2026-11-17T22:00:00+07:00','2026-11-18T06:00:00+07:00');assert.equal(night[0].code,'PART_TIME_HOLIDAY_WORK');
 assert.equal((await workWarnings(db,10,'2026-11-17T20:00:00+07:00','2026-11-18T00:00:00+07:00')).length,0);
 const calendar=await leaveCalendar(db,10,'2026-11-16','2026-11-20');assert.equal(calendar.calendar_days,5);assert.equal(calendar.holiday_days,1);assert.equal(calendar.working_days,4);assert.equal((await leaveCalendar(db,12,'2026-11-18','2026-11-18')).working_days,null);
 const {LeaveRecordsService}=require('../src/modules/leave-records/leave-records.service');
 await c.query("ALTER TABLE employee_leave_records ADD COLUMN leave_type_id int;INSERT INTO employee_leave_records VALUES(1,10,'2026-11-16','2026-11-20','ACTIVE',1)");
 const leaveService=new LeaveRecordsService({transaction:fn=>fn(db),actor:async()=>({id:1})});
 const leaveSummary=await leaveService.list(1,{employee_id:10,from:'2026-11-16',to:'2026-11-20'},false,true);
 assert.equal(leaveSummary.data[0].total_days,4);assert.equal(leaveSummary.data[0].holiday_days,1);assert.equal(leaveSummary.data[0].calendar_days,5);
 await c.query('DELETE FROM employee_leave_records');
 const upload=await file([['Second day','2026-11-19','2026-11-19','']]);const preview=await service.import(1,upload);assert.equal(preview.inserted,0);assert.equal((await c.query('SELECT count(*)::int AS n FROM holidays')).rows[0].n,1);
 await assert.rejects(service.import(1,upload,true,'bad'),e=>e.statusCode===409);
 assert.equal((await service.import(1,upload,true,preview.fingerprint)).inserted,1);assert.equal((await service.import(1,upload,true,preview.fingerprint)).skipped,1);
 const invalid=await file([['Valid new','2026-11-20','2026-11-20',''],['Bad overlap','2026-11-18','2026-11-19','']]);const invalidPreview=await service.import(1,invalid);assert.equal(invalidPreview.failed,1);await assert.rejects(service.import(1,invalid,true,invalidPreview.fingerprint),e=>e.statusCode===422&&e.details.rows.length===2);assert.equal((await c.query('SELECT count(*)::int AS n FROM holidays')).rows[0].n,2);
 const repeated=await service.import(1,await file([['Third','2026-11-20','2026-11-20',''],['Third','2026-11-20','2026-11-20','']]));assert.equal(repeated.valid,1);assert.equal(repeated.skipped,1);
 // Existing import preview renders warnings and uses the normal warning acknowledgment flow.
 const {AttendanceImportService}=require('../src/modules/attendance/attendance-import.service');
 const refs={employees:(await c.query('SELECT * FROM employees')).rows,schedules:(await c.query('SELECT * FROM work_schedules')).rows};
 const attendance=new AttendanceImportService({references:async()=>refs,current:async()=>null,overlapping:async()=>[]},
   {clock:()=>new Date('2026-11-19T12:00:00+07:00')});
 const rows=await attendance.build(db,[{excel_row:2,employee_code:'PT010',shift_type:'DAY',check_in:'2026-11-18T08:00:00+07:00',check_out:'2026-11-18T17:00:00+07:00'}]);assert.equal(rows[0].validation_status,'WARNING');assert(rows[0].issues.some(i=>i.code==='PART_TIME_HOLIDAY_WORK'));assert.equal(rows[0].working_minutes,480);
 const express=require('express'),app=express();app.use(express.json());app.use('/api/holidays',createHolidayRouter({pool,service,authenticate:(req,res,next)=>{if(!req.headers.authorization)return res.sendStatus(401);req.auth={userId:Number(req.headers.authorization)};next();}}));
 server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const url=`http://127.0.0.1:${server.address().port}/api/holidays`;
 assert.equal((await fetch(url)).status,401);assert.equal((await fetch(url,{headers:{Authorization:'2'}})).status,403);const list=await fetch(url,{headers:{Authorization:'1'}});assert.equal(list.status,200);assert.equal((await list.json()).data.length,2);
 const body=new FormData();body.append('file',new Blob([upload.buffer]),'holidays.xlsx');const httpPreview=await fetch(url+'/import',{method:'POST',headers:{Authorization:'1'},body});assert.equal(httpPreview.status,200);assert.equal((await httpPreview.json()).mode,'PREVIEW');
 // Failure in auditing must roll back the holiday insert as well.
 await c.query("ALTER TABLE audit_logs ADD CONSTRAINT reject_new CHECK(action<>'CREATE') NOT VALID");await assert.rejects(service.create(1,{name:'Audit rollback',start_date:'2026-12-01',end_date:'2026-12-01'}));assert.equal((await c.query('SELECT count(*)::int AS n FROM holidays')).rows[0].n,2);
 }finally{if(server)await new Promise(r=>server.close(r));await c.query('ROLLBACK');await c.query('DISCARD TEMP');c.release();await p.end();}
});
