const test=require('node:test');
const assert=require('node:assert/strict');
const Excel=require('exceljs');
const {parseWorkbook}=require('../src/modules/employees/employees.import');
const {EmployeesRepository}=require('../src/modules/employees/employees.repository');
const sample={headers:['fullName','email','phone','dateOfBirth','gender','address','departmentName','positionName','hireDate','employmentType','currentSalary','shift_type'],employees:[['Nguyễn Văn An','an@example.com','0987701101','1998-05-12','MALE','123 Nguyễn Văn Linh, TP.HCM','Customer Support','Customer Support Specialist','2025-01-01','FULL_TIME',18000000,'General']],eduHeaders:['email','educationLevel','fieldOfStudy','institution','institutionRefId','graduationYear'],education:[['an@example.com','Bachelor','Business','Test University','https://ror.org/012345678',2020]]};
async function workbook(codes,{single=false,omit=false}={}){
 const w=new Excel.Workbook();
 const e=w.addWorksheet('Employees'),ed=single?null:w.addWorksheet('Educations');
 e.addRow([...sample.headers,...(omit?[]:['employee_code']),...(single?['educations']:[])]);
 if(ed)ed.addRow(sample.eduHeaders);
 codes.forEach((code,i)=>{
  const row=[...sample.employees[0]];row[1]=`worker${i}@example.com`;row[2]=`09877011${String(i).padStart(2,'0')}`;
  const education=[...sample.education[0]];education[0]=row[1];
  e.addRow([...row,...(omit?[]:[code]),...(single?[JSON.stringify([Object.fromEntries(sample.eduHeaders.slice(1).map((h,j)=>[h,education[j+1]]))])]:[])]);
  if(ed)ed.addRow(education);
 });
 return parseWorkbook(await w.xlsx.writeBuffer());
}
test('two sheets and single sheet preserve and normalize employee_code',async()=>{
 for(const single of [false,true]){const rows=await workbook([' nv-001 '],{single});assert.equal(rows[0].input.employeeCode,'NV-001');assert.equal(rows[0].input.employee_code,undefined);}
});
test('blank and old templates keep automatic code generation',async()=>{
 for(const opts of [{},{omit:true}]){const rows=await workbook([''],opts);assert(rows[0].input);assert.equal(rows[0].input.employeeCode,undefined);}
});
test('reject duplicate codes regardless of case with a row error',async()=>{
 const rows=await workbook(['nv001','NV001']);assert(rows[0].input);assert.equal(rows[1].statusCode,409);assert.match(rows[1].message,/Duplicate employee_code/);
});
test('reject malformed, overlong and numeric cells',async()=>{
 for(const code of ['BAD CODE','_BAD','A'.repeat(51),123]){const rows=await workbook([code]);assert.equal(rows[0].statusCode,400);assert.match(rows[0].message,/employee_code/);}
});
test('existing code is rejected before any insert',async()=>{
 let inserts=0;
 const repository=new EmployeesRepository({async query(sql){if(sql.includes('INSERT INTO employees'))inserts++;return{rows:sql.startsWith('SELECT id FROM employees WHERE upper')?[{id:1}]:[]};}});
 repository.assertPhoneAvailable=async()=>{};
 await assert.rejects(repository.create({phone:'0987701101',employeeCode:'NV001'}),e=>e.statusCode===409&&/employee_code/.test(e.message));assert.equal(inserts,0);
});
test('automatic codes skip codes already supplied by HR and preserve ids beyond 999',async()=>{
 let nextId=998;const inserted=[];
 const repository=new EmployeesRepository({async query(sql,args){
  if(sql.startsWith('SELECT nextval'))return{rows:[{id:++nextId}]};
  if(sql.startsWith('SELECT id FROM employees WHERE upper'))return{rows:args[0]==='EMP999'?[{id:1}]:[]};
  if(sql.includes('INSERT INTO employees')){inserted.push(args);return{rows:[{id:args[14],employeeCode:args[13]}]};}
  return{rows:[]};
 }});
 repository.assertPhoneAvailable=async()=>{};
 const result=await repository.create({phone:'0987701101'});
 assert.equal(result.employeeCode,'EMP1000');assert.equal(result.id,1000);assert.equal(inserted.length,1);
});
test('custom code reaches the insert unchanged',async()=>{
 const repository=new EmployeesRepository({async query(sql,args){
  if(sql.startsWith('SELECT nextval'))return{rows:[{id:42}]};
  if(sql.includes('INSERT INTO employees'))return{rows:[{id:args[14],employeeCode:args[13]}]};
  return{rows:[]};
 }});
 repository.assertPhoneAvailable=async()=>{};
 const result=await repository.create({phone:'0987701101',employeeCode:'NV-001'});
 assert.equal(result.employeeCode,'NV-001');assert.equal(result.id,42);
});
