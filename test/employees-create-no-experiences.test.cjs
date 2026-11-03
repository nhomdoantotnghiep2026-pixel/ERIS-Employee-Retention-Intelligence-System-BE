const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { validateCreateEmployeeInput } = require('../src/modules/employees/employees.validation');
const { EmployeesController } = require('../src/modules/employees/employees.controller');
const { EmployeeBackgroundRepository } = require('../src/modules/employees/employee-background.repository');
const { errorHandler } = require('../src/common/middleware/error-handler');
const { employeesPaths } = require('../src/modules/employees/employees.swagger');
const valid = { fullName:'Nguyễn Văn An',email:'employee@example.invalid',phone:'0901234567',dateOfBirth:'2000-01-15',gender:'MALE',address:'123 Nguyễn Văn Linh, TP.HCM',departmentId:1,positionId:1,hireDate:'2026-11-03',employmentType:'FULL_TIME',currentSalary:18000000,educations:[{educationLevel:2,institution:'Test University',institutionRefId:'https://ror.org/012345678',graduationYear:2022}] };
test('POST employees accepts no workExperiences; rejects removed field; still validates education', async () => {
  let calls=0;
  const controller = new EmployeesController({ async createEmployee({employee}) { calls++; assert(!Object.hasOwn(employee,'workExperiences')); return {...employee,id:1}; } });
  const app=express(); app.use(express.json()); app.post('/api/employees',(req,_res,next)=>{req.auth={userId:1};next();},controller.createEmployee);app.use(errorHandler);
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  try {
    const post=body=>fetch(`http://127.0.0.1:${server.address().port}/api/employees`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const ok=await post(valid);assert.equal(ok.status,201);const result=await ok.json();assert(!Object.hasOwn(result.data,'workExperiences'));assert.equal(calls,1);
    for(const value of [[],null,[{companyName:'Old company'}]]) {
      const bad=await post({...valid,workExperiences:value});assert.equal(bad.status,400);assert.equal((await bad.json()).message,'Request body contains unsupported fields.');
    }
    const missing=await post({...valid,educations:undefined});assert.equal(missing.status,400);assert.equal(calls,1,'invalid requests do not reach creation service');
  } finally {await new Promise(resolve=>server.close(resolve));}
});
test('Shared import validation still supports workExperiences explicitly',()=>{
  const employee=validateCreateEmployeeInput({...valid,workExperiences:[]},{includeWorkExperiences:true});assert.deepEqual(employee.workExperiences,[]);
});
test('Background create without experience data only inserts educations and omits experience response',async()=>{
  const queries=[];
  const client={async query(sql,args){queries.push(sql);assert(!/employee_work_experiences/i.test(sql));return{rows:[{id:1,educationLevel:args[1],institution:args[3],status:args[5]}]};}};
  const result=await new EmployeeBackgroundRepository(client).create(1,validateCreateEmployeeInput(valid),'IN_PROCESS');
  assert.equal(queries.length,1);assert.equal(result.educations.length,1);assert.equal(result.backgroundStatus,'PENDING_ACTIVATION');assert(!Object.hasOwn(result,'workExperiences'));
});
test('POST employees Swagger no longer includes workExperiences',()=>{
  const schema=employeesPaths['/api/employees'].post.requestBody.content['application/json'].schema;
  assert(!Object.hasOwn(schema.properties,'workExperiences'));assert(!schema.required.includes('workExperiences'));assert(schema.required.includes('educations'));
});
