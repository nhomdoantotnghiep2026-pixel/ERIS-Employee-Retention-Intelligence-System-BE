const test=require('node:test'),assert=require('node:assert/strict');
const {prepareImportInstitutions,parseInstitutionChoices,institutionPreview}=require('../src/modules/employees/helpers/import-institutions');
const {validateEducation}=require('../src/modules/employee-education/education.validation');
const {EducationService}=require('../src/modules/employee-education/education.service');
const row=(institution='Test University')=>({row:2,input:{email:'test@example.com',educations:[{educationLevel:'Bachelor',institution,graduationYear:2020}]}});
const candidate=(id,institution='Test University')=>({id,institution,source:'ROR'});
test('name-only education is allowed only in import; other validations remain enforced',()=>{
 const input=row().input.educations[0];assert.throws(()=>validateEducation(input));
 assert.equal(validateEducation(input,{allowUnverifiedInstitution:true}).institutionRefId,null);
 assert.throws(()=>validateEducation({...input,institution:''},{allowUnverifiedInstitution:true}));
 assert.throws(()=>validateEducation({...input,institutionRefId:'invalid'},{allowUnverifiedInstitution:true}));
});
test('unique exact normalized name auto-matches; fuzzy or duplicate names require HR selection',async()=>{
 for(const list of [[candidate('a')],[candidate('a'),candidate('b')],[candidate('a','Test University Campus')]]){
  const rows=await prepareImportInstitutions([row('  TEST University ')],{searchInstitutions:async()=>({data:list})});
  assert.equal(rows[0].needsSelection,list.length!==1||list[0].institution!=='Test University');
  assert.equal(institutionPreview(rows).pending,rows[0].needsSelection?1:0);
 }
});
test('selected candidate is applied to the correct qualification; stale/forged/duplicate choices are rejected',async()=>{
 const rows=[row()],list=[candidate('a'),candidate('b','Other University')];
 const choices=parseInstitutionChoices(JSON.stringify([{row:2,educationIndex:0,institutionRefId:'b'}]),rows);
 const prepared=await prepareImportInstitutions(rows,{searchInstitutions:async()=>({data:list})},choices);
 assert.equal(prepared[0].input.educations[0].institution,'Other University');
 assert.equal(prepared[0].needsSelection,false);
 const bad=await prepareImportInstitutions(rows,{searchInstitutions:async()=>({data:list})},new Map([['2:0','forged']]));
 assert.equal(bad[0].status,'FAILED');
 for(const value of ['{}','broken',JSON.stringify([{row:3,educationIndex:0,institutionRefId:'a'}]),JSON.stringify([{row:2,educationIndex:0,institutionRefId:'a'},{row:2,educationIndex:0,institutionRefId:'b'}])])assert.throws(()=>parseInstitutionChoices(value,rows));
});
test('no match and provider outage retain original school with warning; name lookup is deduplicated',async()=>{
 for(const unavailable of [false,true]){
  let calls=0;const rows=await prepareImportInstitutions([row(),{...row(),row:3}],{searchInstitutions:async()=>{calls++;if(unavailable)throw Object.assign(Error('offline'),{statusCode:503});return{data:[]};}});
  assert.equal(calls,1);assert.equal(rows[0].input.educations[0].institution,'Test University');
  assert.equal(rows[0].input.educations[0].institutionRefId,undefined);assert.ok(rows[0].institutions[0].warning);
  assert.equal(institutionPreview(rows).valid,2);
 }
});
test('aliases resolving to the same school do not create duplicate qualifications',async()=>{
 const entry=row();entry.input.educations.push({...entry.input.educations[0],institution:'School alias'});
 const refs=new Map([['2:0','https://ror.org/012345678'],['2:1','https://ror.org/012345678']]);
 const result=await prepareImportInstitutions([entry],{searchInstitutions:async()=>({data:[candidate('https://ror.org/012345678')]})},refs);
 assert.equal(result[0].status,'FAILED');assert.match(result[0].message,/trùng/);
});
test('name-only import reaches background preparation without external verification; selected references are reverified',async()=>{
 let resolved=0;
 const service=new EducationService({assertHr:async()=>{}},async()=>({data:[]}),async id=>{resolved++;return{id,institution:'Test University'};});
 assert.equal((await service.prepareForEmployeeCreation(1,[row().input.educations[0]],'1990-01-01',{allowUnverifiedInstitution:true}))[0].institution,'Test University');
 assert.equal(resolved,0);
 await assert.rejects(service.prepareForEmployeeCreation(1,[row().input.educations[0]],'1990-01-01'));
 await service.prepareForEmployeeCreation(1,[{...row().input.educations[0],institutionRefId:'https://ror.org/012345678'}],'1990-01-01',{allowUnverifiedInstitution:true});assert.equal(resolved,1);
});
test('HTTP preview reads only; import blocks unresolved schools before creating anyone and accepts HR choices',async t=>{
 const express=require('express'),Excel=require('exceljs');
 const {registerEmployeeImport}=require('../src/modules/employees/services/employees.import');
 let created=0;
 const candidates=[candidate('https://ror.org/012345678'),candidate('https://ror.org/123456789')];
 const service={assertHr:async()=>{},educationService:{searchInstitutions:async()=>({data:candidates})},
  createEmployee:async({employee})=>{created++;assert.equal(employee.educations[0].institutionRefId,candidates[1].id);return{id:1};},
  employeesRepository:{recordImportAudit:async()=>{}}};
 const app=express(),router=express.Router();registerEmployeeImport(router,(req,res,next)=>{req.auth={userId:1};next();},service);app.use(router);
 app.use((error,req,res,next)=>res.status(error.statusCode||500).json({message:error.message}));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(()=>server.close());
 const book=new Excel.Workbook(),sheet=book.addWorksheet('Employees');
 sheet.addRow(['employee_code','fullName','email','phone','dateOfBirth','gender','address','departmentName','positionName','hireDate','employmentType','currentSalary','shift_type','educations']);
 sheet.addRow(['NV001','Test Employee','test@example.com','0987654321','1990-01-01','MALE','123 Street','Engineering','Software Engineer','2025-01-01','FULL_TIME',15000000,'General',JSON.stringify(row().input.educations)]);
 const bytes=await book.xlsx.writeBuffer();
 const post=async(path,choices)=>{const form=new FormData();form.append('file',new Blob([bytes]),'employees.xlsx');if(choices)form.append('institutionChoices',JSON.stringify(choices));return fetch(`http://127.0.0.1:${server.address().port}${path}`,{method:'POST',body:form});};
 let response=await post('/import/preview');assert.equal(response.status,200);assert.equal((await response.json()).pending,1);assert.equal(created,0);
 response=await post('/import');assert.equal(response.status,409);assert.equal(created,0);
 response=await post('/import',[{row:2,educationIndex:0,institutionRefId:candidates[1].id}]);assert.equal(response.status,200);assert.equal((await response.json()).created,1);assert.equal(created,1);
});
