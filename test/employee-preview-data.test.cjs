const test=require('node:test'),assert=require('node:assert/strict'),Excel=require('exceljs');
const {parseWorkbook}=require('../src/modules/employees/employees.import');
const {prepareImportInstitutions,institutionPreview}=require('../src/modules/employees/import-institutions');
const base=['EMP001','Test Employee','test@example.com','0901234567','1990-01-01','MALE','12 Nguyen Hue','Engineering','Software Engineer','Junior','2024-01-01','FULL_TIME',15000000,'General'];
const headers=['employee_code','fullName','email','phone','dateOfBirth','gender','address','departmentName','positionName','job_level','hireDate','employmentType','currentSalary','shift_type'];
const degrees=[{educationLevel:'Bachelor',institution:'School A',graduationYear:2012},{educationLevel:'Master',institution:'School B',graduationYear:2015}];
test('preview returns the entire original row and grouped educations even when validation fails in either sheet',async()=>{
 for(const single of [true,false])for(const bad of ['none','phone','education','formula']){
  const book=new Excel.Workbook(),employees=book.addWorksheet('Employees');employees.addRow([...headers,...(single?['educations']:[])]);
  const values=[...base];if(bad==='phone')values[3]='bad phone';if(bad==='formula')values[3]={formula:'1+1'};
  const education=degrees.map(e=>({...e}));if(bad==='education')education[1].graduationYear=1800;
  employees.addRow([...values,...(single?[JSON.stringify(education)]:[])]);
  if(!single){const sheet=book.addWorksheet('Educations');sheet.addRow(['email','educationLevel','institution','graduationYear']);for(const degree of education)sheet.addRow([base[2],degree.educationLevel,degree.institution,degree.graduationYear]);}
  const parsed=await parseWorkbook(await book.xlsx.writeBuffer());
  const prepared=await prepareImportInstitutions(parsed,{searchInstitutions:async()=>({data:[]})});
  const row=institutionPreview(prepared).results[0];
  assert.equal(row.employee.fullName,base[1]);assert.equal(row.employee.currentSalary,15000000);assert.equal(row.employee.departmentName,'Engineering');assert.equal(row.employee.educations.length,2);
  if(bad==='none')assert.equal(row.status,'VALID');else{assert.equal(row.status,'FAILED');assert.ok(row.issue);}
  if(bad==='formula')assert.equal(row.employee.phone,'=1+1');
  if(bad==='education'&&!single)assert.equal(row.issue.cell,'D3');
 }
});
