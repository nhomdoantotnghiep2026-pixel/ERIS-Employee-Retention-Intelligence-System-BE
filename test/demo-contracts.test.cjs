const test=require('node:test');
const assert=require('node:assert/strict');
const ExcelJS=require('exceljs');
const {parseWorkbook}=require('../src/modules/employees/employees.import');
const {EmployeeBackgroundRepository}=require('../src/modules/employees/employee-background.repository');
const {validateRegisterHrInput}=require('../src/modules/auth/auth.validation');
const {validateCreatePositionInput}=require('../src/modules/positions/positions.validation');

test('Survey APIs are registered in Swagger',()=>{
  const {swaggerSpec}=require('../src/config/swagger');
  assert(swaggerSpec.paths['/api/surveys']);
  assert(swaggerSpec.paths['/api/surveys/{id}/responses'].get);
});

const employee={fullName:'Demo Employee',email:'demo@example.invalid',phone:'0901234567',dateOfBirth:'1990-01-01',gender:'MALE',address:'364 Cộng Hòa, Hồ Chí Minh',departmentId:1,positionId:1,hireDate:'2020-01-01',employmentType:'FULL_TIME',currentSalary:15000000};
const school={educationLevel:'Bachelor',institution:'Demo University',institutionRefId:'https://ror.org/012345678',fieldOfStudy:'IT',graduationYear:2012};

test('Current HR/position forms use the required names and department relationship',()=>{
  const hr=validateRegisterHrInput({email:' DEMO@example.invalid ',full_name:'  Demo HR  ',hireDate:'2026-11-04'});
  assert.equal(hr.fullName,'Demo HR');assert.equal(hr.email,'demo@example.invalid');
  assert.throws(()=>validateRegisterHrInput({email:'demo@example.invalid',fullName:'Wrong field'}));
  assert.throws(()=>validateCreatePositionInput({name:'Developer',jobLevel:2}));
  assert.equal(validateCreatePositionInput({name:'Developer',jobLevel:2,departmentId:1}).departmentId,1);
});
test('Two-sheet import accepts Employees + Educations, no experience column or table',async()=>{
  const book=new ExcelJS.Workbook(),staff=book.addWorksheet('Employees'),education=book.addWorksheet('Educations');
  const fields=Object.keys(employee);staff.addRow(fields);staff.addRow(Object.values(employee));
  const headers=['email',...Object.keys(school)];education.addRow(headers);education.addRow([employee.email,...Object.values(school)]);
  const rows=await parseWorkbook(Buffer.from(await book.xlsx.writeBuffer()));
  assert.equal(rows.length,1);assert.equal(rows[0].input.educations.length,1);assert(!Object.hasOwn(rows[0].input,'workExperiences'));
  book.addWorksheet('WorkExperiences').addRow(['email']);
  const legacy=Buffer.from(await book.xlsx.writeBuffer());
  await assert.rejects(()=>parseWorkbook(legacy),error=>error.statusCode===400);
});
test('One-sheet JSON education import remains supported; duplicate emails are reported per row',async()=>{
  const book=new ExcelJS.Workbook(),sheet=book.addWorksheet('Employees');
  sheet.addRow([...Object.keys(employee),'educations']);
  const record=[...Object.values(employee),JSON.stringify([school])];sheet.addRow(record);sheet.addRow(record);
  const rows=await parseWorkbook(Buffer.from(await book.xlsx.writeBuffer()));
  assert(rows[0].input);assert.equal(rows[1].status,'FAILED');assert.equal(rows[1].statusCode,409);
});
test('Activation and background reads no longer query the removed work experience table',async()=>{
  const queries=[];const client={query:async sql=>{queries.push(sql);return {rows:[]};}};
  const repository=new EmployeeBackgroundRepository(client);
  await repository.activate(1);const data=await repository.find(1,true);
  assert(!queries.some(sql=>/employee_work_experiences/.test(sql)));
  assert(!Object.hasOwn(data,'workExperiences'));assert.deepEqual(data.educations,[]);
});
