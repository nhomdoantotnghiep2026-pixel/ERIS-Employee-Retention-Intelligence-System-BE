const path=require('path');const req=require('module').createRequire(path.join(path.resolve(__dirname,'..'),'package.json'));
const test=require('node:test'),assert=require('node:assert/strict');
const {EmployeesService}=req('./src/modules/employees/employees.service');
const {EmployeesRepository}=req('./src/modules/employees/employees.repository');
const {validateCreateEmployeeInput}=req('./src/modules/employees/employees.validation');
const input={fullName:'HR B',email:'b@example.com',phone:'0901234567',dateOfBirth:'1995-01-01',gender:'MALE',address:'364 Cộng Hòa, Hồ Chí Minh',addressRefId:'chosen',departmentId:1,positionId:1,hireDate:'2026-10-20',employmentType:'FULL_TIME',currentSalary:15000000};
function setup(){
 const state={target:{id:2,email:input.email,role:'HR',status:'ACTIVE',employeeId:null},actor:{id:1,role:'HR',status:'ACTIVE',employeeId:10},created:0,linked:0,transactions:0,duplicate:false};
 const repository={preflightCreate:async()=>({actorRole:state.actor.role,emailExists:true,activeDepartment:true,activePosition:true}),findAccountByEmail:async()=>state.target,findUserRoleById:async()=>state.actor,findHrTarget:async id=>id===1?state.actor:state.target,
 withTransaction:async work=>{state.transactions++;return work(repository)},databasePool:{query:async()=>({rows:[]})},findByEmail:async()=>state.duplicate?{id:20}:null,
 findActiveDepartmentById:async()=>({id:1}),findActivePositionById:async()=>({id:1}),create:async e=>{state.created++;return{id:20,employeeCode:'EMP020',...e}},
 linkHrProfile:async(id,e)=>{state.linked++;return{id,employeeId:e.id,role:'HR',status:'ACTIVE'}},findById:async id=>({id,employmentStatus:'ACTIVE',distanceFromHomeKm:25}),update:async(id,e)=>({id,...e}),deactivate:async()=>({})};
 const service=new EmployeesService({employeesRepository:repository,distanceService:{geocodeFull:async()=>[],placeByRefId:async()=>({hs_num:'364',street:'Cộng Hòa',city:'Hồ Chí Minh',lat:10.8,lng:106.6}),calculate:async()=>({distanceFromHomeKm:25})},mailTransporter:{sendMail:async()=>{throw Error('must not send')} }});
 return{state,repository,service,create:()=>service.createEmployee({actorId:1,employee:validateCreateEmployeeInput(input)})};
}
test('HR links generated profile to existing account without password, role change or email',async()=>{
 const x=setup();const result=await x.create();assert.equal(result.employeeCode,'EMP020');assert.equal(result.distanceFromHomeKm,25);assert.deepEqual(result.account,{id:2,employeeId:20,role:'HR',status:'ACTIVE'});assert.equal(x.state.created,1);assert.equal(x.state.linked,1);
});
test('reject self, inactive/non-HR target, mismatched email and existing profile before routing/persistence',async()=>{
 for(const [patch,code] of [[{id:1},403],[{role:'EMPLOYEE'},409],[{status:'IN_PROCESS'},409],[{email:'other@example.com'},400],[{employeeId:99},409]]){
 const x=setup();Object.assign(x.state.target,patch);await assert.rejects(x.create(),e=>e.statusCode===code);assert.equal(x.state.created,0);assert.equal(x.state.transactions,0);
 }
});
test('rechecks ownership/duplicate inside transaction, missing distance never writes',async()=>{
 let x=setup();x.state.duplicate=true;await assert.rejects(x.create(),e=>e.statusCode===409);assert.equal(x.state.created,0);
 x=setup();x.repository.withTransaction=async work=>{x.state.target.employeeId=99;return work(x.repository)};await assert.rejects(x.create(),e=>e.statusCode===409);assert.equal(x.state.created,0);
 x=setup();x.service.distanceService.calculate=async()=>({distanceFromHomeKm:null});await assert.rejects(x.create(),e=>e.statusCode===422);assert.equal(x.state.transactions,0);
});
test('self update permits phone, forbids salary/name and self deletion; other HR may edit',async()=>{
 const x=setup();for(const employee of [{currentSalary:20000000},{fullName:'New name'},{phone:'0900000000',departmentId:1}])await assert.rejects(x.service.updateEmployee({actorId:1,employeeId:10,employee}),e=>e.statusCode===403);
 assert.equal((await x.service.updateEmployee({actorId:1,employeeId:10,employee:{phone:'0900000000'}})).phone,'0900000000');
 await assert.rejects(x.service.deleteEmployee({actorId:1,employeeId:10}),e=>e.statusCode===403);
 assert.equal((await x.service.updateEmployee({actorId:1,employeeId:20,employee:{currentSalary:20000000}})).currentSalary,20000000);
});
test('repository transaction rolls back failed linking and releases connection',async()=>{
 const calls=[];const repo=new EmployeesRepository({connect:async()=>({query:async sql=>{calls.push(sql);return{rows:[]}},release:()=>calls.push('RELEASE')})});
 await assert.rejects(repo.withTransaction(async r=>{await r.linkHrProfile(2,{id:20,fullName:'HR'});}));assert.ok(calls.includes('ROLLBACK'));assert.equal(calls.includes('COMMIT'),false);assert.equal(calls.at(-1),'RELEASE');
});
test('HTTP HR profile route reuses required validation and rejects client generated IDs',async()=>{
 const express=req('express');const {EmployeesController}=req('./src/modules/employees/employees.controller');const {createEmployeesRouter}=req('./src/modules/employees/employees.routes');
 const x=setup(),app=express();app.use(express.json());app.use('/api/employees',createEmployeesRouter({employeesController:new EmployeesController(x.service),authenticate:(r,s,n)=>{r.auth={userId:1};n()}}));app.use((e,r,s,n)=>s.status(e.statusCode||500).json({message:e.message}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const url='http://127.0.0.1:'+server.address().port+'/api/employees';
 const send=body=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 try{
 for(const patch of [{currentSalary:0},{employeeId:99},{employeeCode:'EMP999'},{email:''},{hrUserId:2}])assert.equal((await send({...input,...patch})).status,400);
 assert.equal((await send(input)).status,201);
 assert.equal((await fetch(url+'/hr-profiles',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)})).status,404);
 }finally{await new Promise(r=>server.close(r));}
});

test('duplicate employee email and existing ADMIN/EMPLOYEE accounts never link',async()=>{
 for(const target of [null,{id:2,role:'ADMIN',status:'ACTIVE'}, {id:2,role:'EMPLOYEE',status:'IN_PROCESS'}]){const x=setup();x.state.target=target;await assert.rejects(x.create(),e=>e.statusCode===409);assert.equal(x.state.created,0);}
});

test('new email creates EMPLOYEE IN_PROCESS and sends invitation through shared endpoint',async()=>{
 const x=setup();let sent=0;
 x.repository.preflightCreate=async()=>({actorRole:'HR',emailExists:false,activeDepartment:true,activePosition:true});
 x.repository.findAccountByEmail=async()=>{throw Error('no account lookup for a new email')};
 x.repository.createWithAccount=async(employee,hash)=>{assert.ok(hash.startsWith('$2'));return{employee:{id:30,...employee},account:{id:40,email:employee.email,role:'EMPLOYEE',status:'IN_PROCESS',employeeId:30}}};
 x.service.initialPassword='Temporary-test-123!';x.service.mailFrom='test@example.com';x.service.mailTransporter={sendMail:async()=>{sent++;return{accepted:[input.email]}}};
 const result=await x.create();assert.equal(result.account.role,'EMPLOYEE');assert.equal(result.account.status,'IN_PROCESS');assert.equal(result.emailDelivery,'SENT');assert.equal(sent,1);assert.equal(x.state.linked,0);
});
test('import uses same email-based HR linking and rejects self-profile row',async()=>{
 const {processEmployeeRows}=req('./src/modules/employees/employees.import');const x=setup();
 const result=await processEmployeeRows([{row:2,input:validateCreateEmployeeInput(input)}],x.service,1);assert.equal(result[0].status,'CREATED');assert.equal(result[0].data.account.role,'HR');assert.equal(x.state.linked,1);
 const y=setup();y.state.target.id=1;const failed=await processEmployeeRows([{row:2,input:validateCreateEmployeeInput(input)}],y.service,1);assert.equal(failed[0].statusCode,403);assert.equal(y.state.created,0);
});
