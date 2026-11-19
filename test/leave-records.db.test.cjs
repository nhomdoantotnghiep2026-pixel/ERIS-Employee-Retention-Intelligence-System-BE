const test=require('node:test'),assert=require('node:assert/strict');
const {databasePool}=require('../src/config/database');
const {LeaveRecordsRepository,lockEmployee,assertNoLeave}=require('../src/modules/leave-records/leave-records.repository');
const {LeaveRecordsService}=require('../src/modules/leave-records/leave-records.service');
test('Leave Records database business rules on session-local TEMP tables',async()=>{
 const db=await databasePool.connect();
 try{
 await db.query(`CREATE TEMP TABLE role(id int primary key,name text);
 CREATE TEMP TABLE users(id int primary key,employee_id int,role_id int,status text,full_name text);
 CREATE TEMP TABLE employees(id int primary key,employee_code text,hire_date date,work_schedule_id int,full_name text,employment_type text DEFAULT 'FULL_TIME');
 CREATE TEMP TABLE leave_types(id int primary key,code text,name text,description text);
 CREATE TEMP TABLE employee_leave_records(id serial primary key,employee_id int,leave_type_id int,start_date date,end_date date,reason text,record_status text DEFAULT 'ACTIVE',recorded_by int,cancellation_reason text,cancelled_by int,created_at timestamptz DEFAULT CURRENT_TIMESTAMP,updated_at timestamptz DEFAULT CURRENT_TIMESTAMP);
 CREATE TEMP TABLE attendance(id serial primary key,employee_id int,work_date date,check_in timestamp,check_out timestamp,working_minutes int,overtime_minutes int,attendance_status text,record_status text DEFAULT 'ACTIVE');
 CREATE TEMP TABLE holidays(id int,name text,start_date date,end_date date,status text);
 CREATE TEMP TABLE work_schedules(id int,status text,working_days int[]);
 INSERT INTO role VALUES(1,'HR'),(2,'EMPLOYEE');INSERT INTO users VALUES(1,9,1,'ACTIVE','Test HR'),(2,10,2,'ACTIVE','Test Employee');
 INSERT INTO employees VALUES(9,'EMP009','2026-01-01',NULL,'A'),(10,'EMP010','2026-01-01',NULL,'B');INSERT INTO leave_types VALUES(1,'LT001','Annual',NULL),(2,'LT002','Sick',NULL);`);
 const pool={query:(...a)=>db.query(...a),connect:async()=>({query:(...a)=>db.query(...a),release(){}})};
 const repo=new LeaveRecordsRepository(pool),service=new LeaveRecordsService(repo);
 const base={employee_id:9,leave_type_id:1,start_date:'2026-11-16',end_date:'2026-11-16',reason:'Personal'};
 const saved=await service.create(1,base);assert.equal(saved.record_status,'ACTIVE');assert.equal(saved.recorded_by,1);assert.equal(saved.start_date,saved.end_date);
 await assert.rejects(()=>service.create(2,base),e=>e.statusCode===403);
 await assert.rejects(()=>service.create(1,{...base,employee_id:999}),e=>e.code==='EMPLOYEE_NOT_FOUND');
 await assert.rejects(()=>service.create(1,{...base,leave_type_id:999}),e=>e.code==='LEAVE_TYPE_NOT_FOUND');
 await assert.rejects(()=>service.create(1,{...base,end_date:'2026-11-18'}),e=>e.statusCode===409);
 assert.equal((await service.list(2,{employee_id:9},true)).data.length,0);
 await assert.rejects(()=>service.detail(2,saved.id),e=>e.statusCode===403);
 await db.query("INSERT INTO attendance(employee_id,work_date,check_in,check_out) VALUES(9,'2026-11-17','2026-11-17 22:00','2026-11-18 06:00')");
 await assert.rejects(()=>service.create(1,{...base,start_date:'2026-11-17',end_date:'2026-11-17'}),e=>e.code==='ATTENDANCE_CONFLICT'&&e.conflicts[0].work_date==='2026-11-17');
 await assert.rejects(()=>assertNoLeave(db,9,'2026-11-16'),e=>e.code==='LEAVE_CONFLICT');
 const {AttendanceImportRepository}=require('../src/modules/attendance/attendance-import.repository');
 await assert.rejects(()=>new AttendanceImportRepository(pool).write(db,{employee_id:9,work_date:'2026-11-16',check_in:'2026-11-16T08:00:00+07:00'},null,1),e=>e.code==='LEAVE_CONFLICT');
 const {AttendanceImportService}=require('../src/modules/attendance/attendance-import.service');
 const snapshot={id:1,shift_type:'HC',start_time:'08:00:00',end_time:'17:00:00',break_start:'12:00:00',break_end:'13:00:00',working_days:[1,2,3,4,5],status:'ACTIVE'};
 const attendanceRepo=new AttendanceImportRepository(pool);
 attendanceRepo.references=async()=>({employees:[{id:9,employee_code:'EMP009',full_name:'A',hire_date:'2026-01-01',work_schedule_id:1}],schedules:[snapshot]});
 const attendanceService=new AttendanceImportService(attendanceRepo,{clock:()=>new Date('2026-11-19T12:00:00+07:00')});
 const built=await attendanceService.build(db,[{excel_row:2,employee_code:'EMP009',shift_type:'HC',check_in:'2026-11-16T08:00:00+07:00',check_out:'2026-11-16T17:00:00+07:00'}]);
 assert.ok(built[0].issues.some(i=>i.code==='LEAVE_CONFLICT'),JSON.stringify(built[0].issues));assert.equal(built[0].action,'BLOCKED');
 await assert.rejects(service.cancel(2,saved.id,{reason:'Correction'}),{statusCode:403});
 await assert.rejects(service.cancel(1,saved.id,{reason:' '}),{statusCode:400});
 await db.query("INSERT INTO attendance(employee_id,work_date,attendance_status) VALUES(9,'2026-11-16','ON_LEAVE')");
 await assert.rejects(service.cancel(1,saved.id,{reason:'Correction'}),{code:'DERIVED_ATTENDANCE_EXISTS'});
 await db.query("UPDATE attendance SET record_status='CANCEL' WHERE attendance_status='ON_LEAVE'");
 const cancelled=await service.cancel(1,saved.id,{reason:'  Correction  '});
 assert.equal(cancelled.reason,base.reason);assert.equal(cancelled.record_status,'CANCEL');
 assert.equal(cancelled.cancellation_reason,'Correction');assert.equal(cancelled.cancelled_by,1);
 await assert.rejects(service.cancel(1,saved.id,{reason:'Again'}),{statusCode:409});
 assert.equal((await service.list(1,{},false,true)).data.length,0);
 const history=await service.cancellations(1,{employee_id:9,cancelled_by:1,from:'2026-11-16',to:'2026-11-16',page:1,limit:10});
 assert.equal(history.data.length,1);assert.equal(history.data[0].cancelled_by_name,'Test HR');
 assert.deepEqual(history.data[0].cancelled_at,cancelled.updated_at);
 assert.equal((await service.cancellations(1,{},saved.id)).id,saved.id);
 await assert.rejects(service.cancellations(2),{statusCode:403});
 const replacementFile={originalname:'replacement.csv',buffer:Buffer.from('employee_code,leave_type,start_date,end_date,reason\nEMP009,LT001,2026-11-16,2026-11-16,Personal')};
 const replacementPreview=await service.import(1,replacementFile);
 const replacement=await service.import(1,replacementFile,true,replacementPreview.fingerprint);
 assert.equal(replacement.inserted,1);assert.notEqual(replacement.rows[0].id,saved.id);
 await assert.rejects(service.cancellations(1,{},replacement.rows[0].id),{statusCode:404});
 const csv='employee_code,leave_type,start_date,end_date,reason\nEMP009,LT001,2026-11-16,2026-11-16,Personal\nEMP010,LT002,2026-11-20,2026-11-21,\nEMP010,LT002,2026-11-20,2026-11-21,\nEMP009,LT002,2026-11-17,2026-11-17,\nUNKNOWN,LT002,2026-11-20,2026-11-21,';
 const file={originalname:'leave.csv',buffer:Buffer.from(csv)},preview=await service.import(1,file);
 assert.deepEqual(preview.summary,{total_rows:5,valid:1,duplicate:2,conflict:1,error:1});
 await assert.rejects(()=>service.import(1,file,true,'wrong'),e=>e.code==='FILE_CHANGED');
 // Changes after preview must be revalidated at confirm.
 await service.create(1,{employee_id:10,leave_type_id:1,start_date:'2026-11-20',end_date:'2026-11-20'});
 const result=await service.import(1,file,true,preview.fingerprint);assert.equal(result.inserted,0);assert.equal(result.conflicted,3);
 const many=['employee_code,leave_type,start_date,end_date,reason'];for(let i=0;i<100;i++){const d=new Date(Date.UTC(2027,0,1+i)).toISOString().slice(0,10);many.push(`${i<10?'UNKNOWN':'EMP010'},LT001,${d},${d},`);}
 const bulk={originalname:'bulk.csv',buffer:Buffer.from(many.join('\n'))};const p=await service.import(1,bulk),r=await service.import(1,bulk,true,p.fingerprint);assert.equal(r.inserted,90);assert.equal(r.failed,10);
 const summary=await service.list(1,{employee_id:10,from:'2027-01-11',to:'2027-01-12'},false,true);assert.equal(summary.data[0].total_days,null);assert.equal(summary.data[0].total_hours,null);
 }finally{await db.query('ROLLBACK');await db.query('DISCARD TEMP');db.release();}
});
test('employee advisory lock excludes a concurrent writer',async()=>{
 const a=await databasePool.connect(),b=await databasePool.connect();try{await a.query('BEGIN');await b.query('BEGIN');await lockEmployee(a,2147483647);const {rows}=await b.query("SELECT pg_try_advisory_xact_lock(hashtext('leave-records:' || $1::text)) AS acquired",[2147483647]);assert.equal(rows[0].acquired,false);await a.query('COMMIT');const next=await b.query("SELECT pg_try_advisory_xact_lock(hashtext('leave-records:' || $1::text)) AS acquired",[2147483647]);assert.equal(next.rows[0].acquired,true);}finally{await a.query('ROLLBACK');await b.query('ROLLBACK');a.release();b.release();}
});
test.after(()=>databasePool.end());
