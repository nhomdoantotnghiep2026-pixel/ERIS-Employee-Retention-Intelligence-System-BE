const test=require('node:test'),assert=require('node:assert/strict');
const ExcelJS=require('exceljs');
const {HEADERS,parse,validate,processRows}=require('../src/modules/attendance/attendance.import');
const fixture=()=>({row:2,errors:[],data:{employee_id:'EMP009',attendance_date:'2025-01-02',shift_type:'DAY',attendance_status:'PRESENT',login_timestamp:'2025-01-02 08:00:00',logout_timestamp:'2025-01-02 18:00:00',total_hours_worked:9,late_arrival_mins:0,early_exit_mins:0,overtime_hours:1,leave_type:null}});
test('accept total including OT; reject invalid dates, metrics, timestamps and status',()=>{
 assert.equal(validate(fixture()).errors.length,0);
 for(const changes of [{total_hours_worked:11},{overtime_hours:10},{attendance_status:'ON_LEAVE'},{attendance_date:'2025-02-30'},{login_timestamp:42},{login_timestamp:'2025-01-02 25:00:00'},{late_arrival_mins:5},{employee_id:10}]){
 const row=fixture();Object.assign(row.data,changes);assert.ok(validate(row).errors.length,JSON.stringify(changes));}
 const leave=fixture();Object.assign(leave.data,{attendance_status:'ON_LEAVE',login_timestamp:null,logout_timestamp:null,total_hours_worked:0,overtime_hours:0,leave_type:'SICK'});assert.equal(validate(leave).errors.length,0);
});
test('parse XLSX, preserve row numbers, reject formulas and wrong headers',async()=>{
 const book=new ExcelJS.Workbook(),sheet=book.addWorksheet('Attendance');sheet.addRow(HEADERS);sheet.addRow(HEADERS.map(k=>fixture().data[k]));
 let rows=await parse(await book.xlsx.writeBuffer());assert.equal(rows[0].row,2);assert.equal(validate(rows[0]).errors.length,0);
 sheet.getCell('G2').value={formula:'1+8',result:9};rows=await parse(await book.xlsx.writeBuffer());assert.ok(rows[0].errors.length);
 sheet.getCell('A1').value='wrong';await assert.rejects(async()=>parse(await book.xlsx.writeBuffer()),e=>e.statusCode===400);
});
function database({shift='DAY',overlap=false,duplicate=false,auditFailure=false}={}){
 const state={writes:[],committed:false,rolledBack:false};const client={release(){},async query(sql,args){
 if(sql==='COMMIT'){state.committed=true;return {rows:[]};}if(sql==='ROLLBACK'){state.rolledBack=true;return {rows:[]};}
 if(sql==='BEGIN'||sql.startsWith('SET '))return {rows:[]};
 if(sql.includes('FROM users'))return {rows:[{id:1}]};
 if(sql.includes('information_schema'))return {rows:Array(5).fill({})};
 if(sql.includes('FROM employees'))return {rows:[{id:10,hire_date:'2024-01-01',work_schedule_id:3}]};
 if(sql.includes('FROM work_schedules')){assert.deepEqual(args,[3]);return {rows:overlap?[]:[{id:3,shift_type:shift,start_time:'08:00:00',end_time:'17:00:00',break_start:'12:00:00',break_end:'13:00:00',working_days:[1,2,3,4,5]}]};}
 if(sql.startsWith('INSERT INTO attendance')){state.writes.push(args);return {rows:duplicate?[]:[{id:77}]};}
 if(sql.includes('SELECT id FROM attendance'))return {rows:[]};
 if(sql.startsWith('INSERT INTO audit_logs')){if(auditFailure)throw Error('audit failed');return {rows:[]};}throw Error(sql);
 }};return {state,connect:async()=>client};
}
test('employee schedule mapping, mismatch, missing schedule, duplicate and audit rollback',async()=>{
 const pool=database();assert.equal((await processRows([fixture()],pool,1)).created,1);assert.equal(pool.state.writes[0].length,10);
 for(const options of [{shift:'NIGHT'},{overlap:true},{duplicate:true}])assert.equal((await processRows([fixture()],database(options),1)).failed,1);
 const dupe=database();assert.equal((await processRows([fixture(),{...fixture(),row:3}],dupe,1)).failed,2);assert.equal(dupe.state.writes.length,0);
 const fail=database({auditFailure:true});await assert.rejects(()=>processRows([fixture()],fail,1),/audit failed/);assert.ok(fail.state.rolledBack);assert.equal(fail.state.committed,false);
});
test('HTTP multipart: HR imports; employee is forbidden; removed check-in/out return 404',async()=>{
 const express=require('express');const {createAttendanceRouter}=require('../src/modules/attendance/attendance.routes');
 const db=database();db.query=async(_sql,[id])=>({rows:[{id,status:'ACTIVE',role_name:id===1?'HR':'EMPLOYEE',employeeId:10,employmentStatus:'ACTIVE'}]});
 const app=express();app.use('/api/v1/attendance',createAttendanceRouter({service:{},databasePool:db,authenticate:(req,res,next)=>{if(!req.headers.authorization)return res.sendStatus(401);req.auth={userId:req.headers.authorization==='HR'?1:2};next();}}));
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
 try{
 const url='http://127.0.0.1:'+server.address().port+'/api/v1/attendance';
 assert.equal((await fetch(url+'/import',{method:'POST'})).status,401);
 assert.equal((await fetch(url+'/import',{method:'POST',headers:{Authorization:'EMPLOYEE'}})).status,403);
 for(const path of ['/check-in','/check-out'])assert.equal((await fetch(url+path,{method:'POST',headers:{Authorization:'HR'}})).status,404);
 const book=new ExcelJS.Workbook(),s=book.addWorksheet('Attendance');s.addRow(HEADERS);s.addRow(HEADERS.map(k=>fixture().data[k]));
 const form=new FormData();form.append('file',new Blob([await book.xlsx.writeBuffer()]),'attendance.xlsx');
 const response=await fetch(url+'/import',{method:'POST',headers:{Authorization:'HR'},body:form});assert.equal(response.status,200);assert.equal((await response.json()).created,1);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
