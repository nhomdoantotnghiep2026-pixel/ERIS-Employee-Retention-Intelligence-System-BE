const test=require('node:test');
const assert=require('node:assert/strict');
const Excel=require('exceljs');
const {parseWorkbook,registerEmployeeImport}=require('../src/modules/employees/services/employees.import');
const {EmployeesRepository}=require('../src/modules/employees/employees.repository');
const sample={headers:['fullName','email','phone','dateOfBirth','gender','address','departmentId','positionId','hireDate','employmentType','currentSalary'],employees:[['Nguyễn Văn An','an@example.com','0987701101','1998-05-12','MALE','123 Nguyễn Văn Linh, TP.HCM',1,1,'2025-01-01','FULL_TIME',18000000]],eduHeaders:['email','educationLevel','fieldOfStudy','institution','institutionRefId','graduationYear'],education:[['an@example.com','Bachelor','Business','Test University','https://ror.org/012345678',2020]]};
async function workbook(codes,{single=false,omit=false,raw=false,assignments,levelColumn='job_level'}={}){
 const w=new Excel.Workbook();
 const e=w.addWorksheet('Employees'),ed=single?null:w.addWorksheet('Educations');
 const headers = assignments
  ? sample.headers.map(field => ({ departmentId: 'departmentName', positionId: 'positionName' })[field] || field)
  : sample.headers;
 e.addRow([...headers,...(omit?[]:['employee_code']),...(single?['educations']:[]),...(assignments?[levelColumn]:[]),'shift_type']);
 if(ed)ed.addRow(sample.eduHeaders);
 codes.forEach((code,i)=>{
  const row=[...sample.employees[0]];row[1]=`worker${i}@example.com`;row[2]=`09877011${String(i).padStart(2,'0')}`;
  if (assignments) [row[6], row[7]] = assignments[i];
  const education=[...sample.education[0]];education[0]=row[1];
  e.addRow([...row,...(omit?[]:[code]),...(single?[JSON.stringify([Object.fromEntries(sample.eduHeaders.slice(1).map((h,j)=>[h,education[j+1]]))])]:[]),...(assignments?[assignments[i][2]]:[]),'General']);
  if(ed)ed.addRow(education);
 });
 const buffer=await w.xlsx.writeBuffer();
 return raw ? buffer : parseWorkbook(buffer);
}
test('two sheets and single sheet preserve and normalize employee_code',async()=>{
 for(const single of [false,true]){const rows=await workbook([' nv-001 '],{single});assert.equal(rows[0].input.employeeCode,'NV-001');assert.equal(rows[0].input.employee_code,undefined);}
});
test('employee code is required in the headers and in each employee row', async () => {
 for (const single of [false, true]) {
  await assert.rejects(workbook([''], { omit: true, single }), /Missing columns: employee_code/);
  const rows = await workbook(['', '   '], { single });
  assert.deepEqual(rows.map(row => row.statusCode), [400, 400]);
  for (const row of rows) assert.match(row.message, /Employee code is required/);
  assert.deepEqual({ sheet: rows[0].issue.sheet, cell: rows[0].issue.cell, field: rows[0].issue.field },
   { sheet: 'Employees', cell: 'L2', field: 'employee_code' });
 }
});
test('prefixed SpreadsheetML workbooks reach the same row and cell validation', async () => {
 const JSZip = require('jszip');
 const normal = await workbook(['BAD CODE'], { raw: true });
 const zip = await JSZip.loadAsync(normal);
 for (const filename of ['xl/workbook.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml']) {
  const xml = await zip.file(filename).async('string');
  zip.file(filename, xml.replace(/<(\/?)(\w+)/gu, '<$1x:$2')
   .replace('xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"', 'xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'));
 }
 const rows = await parseWorkbook(await zip.generateAsync({ type: 'nodebuffer' }));
 assert.equal(rows[0].issue.cell, 'L2');
 assert.equal(rows[0].issue.field, 'employee_code');
});
test('education validation points to the actual Educations cell', async () => {
 const file = new Excel.Workbook();
 await file.xlsx.load(await workbook(['NV-1'], { raw: true }));
 file.getWorksheet('Educations').getCell('B2').value = 'Unknown degree';
 const rows = await parseWorkbook(await file.xlsx.writeBuffer());
 assert.equal(rows[0].issue.sheet, 'Educations');
 assert.equal(rows[0].issue.cell, 'B2');
 assert.equal(rows[0].issue.field, 'educationLevel');
});
test('reject duplicate codes regardless of case with a row error',async()=>{
 const rows=await workbook(['nv001','NV001']);assert(rows[0].input);assert.equal(rows[1].statusCode,409);assert.match(rows[1].message,/Duplicate employee_code/);
});
test('reject malformed, overlong and numeric cells',async()=>{
 for(const code of ['BAD CODE','_BAD','A'.repeat(51),123]){const rows=await workbook([code]);assert.equal(rows[0].statusCode,400);assert.match(rows[0].message,/employee_code/);}
});
const catalog = [
 { departmentId: 8, departmentName: 'Kỹ thuật', positionId: 41, positionName: 'Lập trình viên', jobLevel: 1 },
 { departmentId: 8, departmentName: 'Kỹ thuật', positionId: 42, positionName: 'Lập trình viên', jobLevel: 2 },
 { departmentId: 9, departmentName: 'Kinh doanh', positionId: 50, positionName: 'Chuyên viên tư vấn', jobLevel: 2 },
];

test('both workbook formats resolve department and position names with row-specific errors', async () => {
 for (const single of [true, false]) {
  const file = await workbook(['NV-1', 'NV-2', 'NV-3', 'NV-4', 'NV-5', 'NV-6'], { single, raw: true, assignments: [
   [' KỸ   THUẬT ', 'lập trình viên', 'junior'],
   ['Kỹ thuật', 'Lập trình viên'],
   ['Kỹ thuật', 'Chuyên viên tư vấn'],
   ['Phòng không tồn tại', 'Lập trình viên'],
   ['Kinh doanh', 'Chuyên viên tư vấn'],
   ['Kỹ thuật', 'Lập trình viên', 2],
  ] });
  const rows = await parseWorkbook(file, async () => catalog);
  assert.equal(rows[0].input.departmentId, 8);
  assert.equal(rows[0].input.positionId, 42);
  assert.equal(rows[0].input.positionName, 'Lập trình viên');
  assert.match(rows[1].message, /Entry, Junior/);
  assert.match(rows[2].message, /Position not found in department/);
  assert.match(rows[3].message, /Active department not found/);
  assert.equal(rows[4].input.positionId, 50);
  assert.match(rows[5].message, /Choose a level/);
 }
 const legacy = await workbook(['NV-1'], { raw: true, levelColumn: 'jobLevel', assignments: [['Kỹ thuật', 'Lập trình viên', 2]] });
 assert.equal((await parseWorkbook(legacy, async () => catalog))[0].input.positionId, 42);
});
test('preview accepts a workbook and reports Excel rows without creating employees', async t => {
 const express = require('express');
 const { AppError } = require('../src/common/errors/app-error');
 const app = express();
 const checked = [];
 let writes = 0;
 const service = {
  educationService:{searchInstitutions:async()=>({data:[{id:"https://ror.org/012345678",institution:"Test University",source:"ROR"}]})},
  async assertHr(actorId) { assert.equal(actorId, 7); },
  async checkCreateEligibility(actorId, employee) {
   assert.equal(actorId, 7);
   assert.equal(employee.departmentId, 8);
   assert.equal(employee.positionId, 42);
   checked.push(employee.employeeCode);
   if (employee.employeeCode === 'NV-TAKEN') throw new AppError(409, 'employee_code already exists.');
  },
  async createEmployee() { writes++; },
  employeesRepository: { async listActiveImportAssignments() { return catalog; }, async recordImportAudit() { writes++; } },
 };
 registerEmployeeImport(app, (req, _res, next) => { req.auth = { userId: 7 }; next(); }, service);
 const server = app.listen(0, '127.0.0.1');
 t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
 await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
 const form = new FormData();
 const assignments = Array.from({ length: 3 }, () => ['Kỹ thuật', 'Lập trình viên', 'Junior']);
 form.append('file', new Blob([await workbook(['NV-NEW', 'NV-TAKEN', 'BAD CODE'], { raw: true, assignments })]), 'employees.xlsx');
 const response = await fetch('http://127.0.0.1:' + server.address().port + '/import/preview', { method: 'POST', body: form });
 assert.equal(response.status, 200);
 const preview = await response.json();
 assert.equal(preview.valid, 1);
 assert.equal(preview.failed, 2);
 assert.deepEqual(preview.results.map(row => [row.row, row.status]), [[2, 'VALID'], [3, 'FAILED'], [4, 'FAILED']]);
 assert.deepEqual(preview.results.slice(1).map(row => [row.issue.sheet, row.issue.cell, row.issue.field]),
  [['Employees', 'L3', 'employee_code'], ['Employees', 'L4', 'employee_code']]);
 const missingHeader = new FormData();
 missingHeader.append('file', new Blob([await workbook(['NV-NEW'], { raw: true, omit: true })]), 'employees.xlsx');
 const headerResponse = await fetch('http://127.0.0.1:' + server.address().port + '/import/preview', { method: 'POST', body: missingHeader });
 assert.equal(headerResponse.status, 200);
 const headerPreview = await headerResponse.json();
 assert.equal(headerPreview.valid, 0);
 assert.equal(headerPreview.fileIssues[0].sheet, 'Employees');
 assert.equal(headerPreview.fileIssues[0].row, 1);
 assert.equal(headerPreview.fileIssues[0].field, 'employee_code');
 assert.deepEqual(checked, ['NV-NEW', 'NV-TAKEN']);
 assert.equal(writes, 0);
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
