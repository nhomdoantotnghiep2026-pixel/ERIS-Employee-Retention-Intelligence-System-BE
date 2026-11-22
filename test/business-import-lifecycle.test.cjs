const test=require('node:test'),assert=require('node:assert/strict'),Excel=require('exceljs');
const {AttendanceImportService}=require('../src/modules/attendance/services/attendance-import.service');
const {EmployeesRepository}=require('../src/modules/employees/employees.repository');
const {EducationRepository}=require('../src/modules/employee-education/education.repository');
test('partial attendance confirmation saves only safe rows; warnings, stale proof and strict mode remain protected',async()=>{
 const workbook=new Excel.Workbook(),sheet=workbook.addWorksheet('Attendance');sheet.addRow(['employee_code','shift_type','work_date','check_in','check_out']);
 for(let i=1;i<=3;i++)sheet.addRow(['EMP00'+i,'GENERAL','2026-11-20','08:00:00','17:00:00']);
 const file={originalname:'attendance.xlsx',buffer:Buffer.from(await workbook.xlsx.writeBuffer())};
 const rows=[1,2,3].map(i=>({excel_row:i+1,employee_id:i,employee_code:'EMP00'+i,work_date:'2026-11-20',action:i===3?'BLOCKED':'INSERT',validation_status:i===3?'ERROR':i===2?'WARNING':'VALID',issues:i===3?[{code:'ATT-018',severity:'ERROR'}]:i===2?[{code:'ATT-023',severity:'WARNING'}]:[],existing:null}));
 for(const mode of ['strict','warnings','partial','stale','bad-mode','only-errors','resolution']){
  const saved=[],db={query:async()=>({rows:[]})};
  const repo={pool:db,actor:async()=>({role_name:'HR'}),transaction:async work=>work(db),references:async()=>({employees:rows.map(r=>({id:r.employee_id,employee_code:r.employee_code}))}),lockKey:async()=>{},current:async()=>null,write:async(db,row)=>{saved.push(row.employee_id);return{id:saved.length};}};
  const service=new AttendanceImportService(repo,{previewSecret:'a'.repeat(32)});
  const current=structuredClone(mode==='only-errors'?[rows[2]]:rows);
  if(mode==='resolution')current[2]={...current[2],validation_status:'WARNING',issues:[{severity:'INFO',requires_resolution:true}]};
  service.build=async()=>structuredClone(current);
  const token=service.proof({id:1},file,current,{choices:{},complete:false});
  if(mode==='stale')service.build=async()=>[{...rows[0],working_minutes:123}];
  const body={preview_token:token,confirm_warnings:mode!=='warnings',...(mode==='strict'?{}:{skip_invalid:mode==='bad-mode'?'true':true})};
  if(mode==='partial'||mode==='resolution'){const result=await service.confirm({id:1},file,body);assert.deepEqual(saved,[1,2]);assert.equal(result.inserted,2);assert.equal(result.skipped_invalid,1);assert.equal(result.excluded,1);}
  else{await assert.rejects(service.confirm({id:1},file,body),error=>error.code===({strict:'UNRESOLVED_ROWS',warnings:'WARNINGS_UNCONFIRMED',stale:'STALE_PREVIEW','bad-mode':'VALIDATION_ERROR','only-errors':'NO_VALID_ROWS'}[mode]));assert.deepEqual(saved,[]);}
 }
});
test('deactivation closes open histories on Vietnam today before employee/user changes, and audits the history',async()=>{
 for(const future of [false,true]){
  const calls=[];let end=null,active=true;
  const db={release(){},query:async(sql,args=[])=>{
   calls.push({sql,args});
   if(sql.includes('FROM users'))return{rows:[{id:1,role:'HR',status:'ACTIVE',employeeId:999}]};
   if(sql.includes('SELECT id, employment_status'))return{rows:[{id:24,employment_status:'ACTIVE'}]};
   if(sql.includes(' AS today'))return{rows:[{today:'2026-11-21'}]};
   if(sql.includes('SELECT id,start_date'))return{rows:[{id:5,start_date:future?'2026-12-01':'2024-01-01'}]};
   if(sql.startsWith('UPDATE public.employee_job_histories')){end=args[1];return{rows:[]};}
   if(sql.includes('SELECT to_jsonb(entity)'))return{rows:[{data:sql.includes('FROM employee_job_histories')?{id:5,end_date:end}:{id:24,employment_status:active?'ACTIVE':'INACTIVE'}}]};
   if(sql.includes('UPDATE employees SET')){active=false;return{rows:[{id:24,employmentStatus:'INACTIVE'}]};}
   return{rows:[]};
  }};
  const result=new EmployeesRepository({connect:async()=>db}).deactivate(24,1);
  if(future){await assert.rejects(result,error=>error.statusCode===409);assert.equal(end,null);assert.equal(active,true);assert.equal(calls.at(-1).sql,'ROLLBACK');}
  else{assert.equal((await result).employmentStatus,'INACTIVE');assert.equal(end,'2026-11-21');assert(calls.some(c=>c.sql.startsWith('INSERT INTO audit_logs')&&c.args.includes('employee_job_histories')));assert.equal(calls.at(-1).sql,'COMMIT');assert(calls.findIndex(c=>c.sql.startsWith('UPDATE public.employee_job_histories'))<calls.findIndex(c=>c.sql.includes('UPDATE employees SET')));}
 }
});
test('HR can read unlinked and unactivated education; inactive/non-HR editing stays forbidden',async()=>{
 for(const status of ['ACTIVE','IN_PROCESS','INACTIVE']){
  const queries=[];const db={release(){},query:async(sql,args)=>{queries.push(sql);if(sql.includes('FROM users u JOIN role'))return{rows:[{status:'ACTIVE',role:'HR',employeeId:999}]};if(sql.includes('FROM employees WHERE id'))return{rows:[{id:24,employment_status:status,dateOfBirth:'1990-01-01'}]};if(sql.includes('FROM public.employee_educations')){assert.deepEqual(args[1],['ACTIVE','IN_PROCESS']);return{rows:[{id:7}]};}return{rows:[]};}};
  const repository=new EducationRepository({connect:async()=>db});const result=await repository.withHrEmployee(1,24,false,r=>r.list(24,true));assert.deepEqual(result,[{id:7}]);assert(!queries.some(sql=>sql.includes('SELECT id FROM users WHERE employee_id')));
  if(status!=='ACTIVE')await assert.rejects(repository.withHrEmployee(1,24,true,async()=>{}),error=>error.statusCode===409);
 }
 const db={release(){},query:async sql=>({rows:sql.includes('FROM users u JOIN role')?[{status:'ACTIVE',role:'EMPLOYEE'}]:[]})};await assert.rejects(new EducationRepository({connect:async()=>db}).withHrEmployee(1,24,false,async()=>{}),error=>error.statusCode===403);
});
