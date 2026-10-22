const test=require('node:test'),assert=require('node:assert/strict');
const {EmployeesService}=require('../src/modules/employees/employees.service');
const {EmployeesRepository}=require('../src/modules/employees/employees.repository');
const employee={fullName:'HR B',email:'hr@example.com',address:'364 Cộng Hòa, Hồ Chí Minh',addressRefId:'chosen',departmentId:1,positionId:1};
const hr={id:2,role:'HR',status:'ACTIVE',employeeId:null};
function serviceSetup(accounts=[hr]){let writes=0;const repository={preflightCreate:async()=>({actorRole:'HR',emailExists:false,accounts,activeDepartment:true,activePosition:true}),createWithAccount:async(e,hash,actorId)=>{assert.equal(hash,null);assert.equal(actorId,1);writes++;return{employee:{id:20,...e},account:{...accounts[0],employeeId:20},accountCreated:false}}};return{repository,writes:()=>writes,service:new EmployeesService({employeesRepository:repository,distanceService:{geocodeFull:async()=>[],placeByRefId:async()=>({hs_num:'364',street:'Cộng Hòa',city:'Hồ Chí Minh',lat:10.8,lng:106.6}),calculate:async()=>({distanceFromHomeKm:25})}})};}
test('existing HR email creates profile without SMTP/password config or second account',async()=>{
 for(const status of ['ACTIVE','IN_PROCESS']){const x=serviceSetup([{...hr,status}]);const r=await x.service.createEmployee({actorId:1,employee});assert.equal(r.account.role,'HR');assert.equal(r.account.status,status);assert.equal(r.account.employeeId,20);assert.equal(r.emailDelivery,undefined);assert.equal(x.writes(),1);}
});
test('employee duplicate rejects first; own/inactive/admin/already linked accounts reject',async()=>{
 let x=serviceSetup();x.repository.preflightCreate=async()=>({actorRole:'HR',emailExists:true});await assert.rejects(x.service.createEmployee({actorId:1,employee}),e=>e.statusCode===409);
 for(const [account,code] of [[{...hr,id:1},403],[{...hr,status:'INACTIVE'},409],[{...hr,role:'ADMIN'},409],[{...hr,role:'EMPLOYEE'},409],[{...hr,employeeId:9},409]]){x=serviceSetup([account]);await assert.rejects(x.service.createEmployee({actorId:1,employee}),e=>e.statusCode===code);assert.equal(x.writes(),0);}
});
function repoSetup({duplicate=false,accounts=[{...hr,email:employee.email,roleId:2}],failUpdate=false}={}){
const calls=[];const client={release:()=>calls.push({sql:'RELEASE'}),query:async(sql,args)=>{calls.push({sql,args});
if(sql.includes('SELECT role.name AS role'))return{rows:[{role:'HR'}]};
if(sql.includes('FROM employees')&&sql.includes('LOWER(email)'))return{rows:duplicate?[{id:9}]:[]};
if(sql.includes('FOR UPDATE OF u'))return{rows:accounts};
if(sql.includes('FROM departments')||sql.includes('FROM positions'))return{rows:[{id:1}]};
if(sql.includes('INSERT INTO employees'))return{rows:[{id:20,fullName:employee.fullName,email:employee.email}]};
if(sql.includes('UPDATE users'))return{rows:failUpdate?[]:[{id:2,email:employee.email,roleId:2,status:'ACTIVE',employeeId:20}]};
if(sql.includes("name='EMPLOYEE'"))return{rows:[{id:3}]};
if(sql.includes('INSERT INTO users'))return{rows:[{id:3,email:employee.email,status:'IN_PROCESS',employeeId:20}]};
return{rows:[]};}};return{calls,repo:new EmployeesRepository({connect:async()=>client})};}
test('HR linking transaction syncs employee_id/full_name without touching password/role/status',async()=>{
 const x=repoSetup();const r=await x.repo.createWithAccount(employee,null,1);assert.equal(r.accountCreated,false);assert.equal(r.account.role,'HR');const update=x.calls.find(c=>c.sql.includes('UPDATE users'));assert.deepEqual(update.args,[2,20,'HR B']);assert.doesNotMatch(update.sql,/password_hash|SET role_id|SET status/);assert.equal(x.calls.some(c=>c.sql.includes('INSERT INTO users')),false);assert.ok(x.calls.some(c=>c.sql==='COMMIT'));
});
test('transaction blocks concurrent employee duplicate and rolls back failed user link',async()=>{
 for(const options of [{duplicate:true},{failUpdate:true},{accounts:[{...hr,employeeId:99}]}]){const x=repoSetup(options);await assert.rejects(x.repo.createWithAccount(employee,null,1),e=>e.statusCode===409);assert.ok(x.calls.some(c=>c.sql==='ROLLBACK'));assert.equal(x.calls.some(c=>c.sql==='COMMIT'),false);assert.equal(x.calls.at(-1).sql,'RELEASE');}
});
test('new email still creates EMPLOYEE IN_PROCESS account',async()=>{
 const x=repoSetup({accounts:[]});const r=await x.repo.createWithAccount(employee,'hashed-password',1);assert.equal(r.accountCreated,true);assert.equal(r.account.role,'EMPLOYEE');assert.equal(r.account.status,'IN_PROCESS');assert.ok(x.calls.some(c=>c.sql.includes('INSERT INTO users')));
});
test('preflight duplicate query only checks employees and reads users as link candidates',async()=>{
 let query;const repo=new EmployeesRepository({query:async(sql)=>{query=sql;return{rows:[{}]}}});await repo.preflightCreate(1,employee);assert.match(query,/EXISTS \(SELECT 1 FROM employees WHERE lower\(email\) = lower\(\$2\)\) AS "emailExists"/);assert.doesNotMatch(query,/UNION ALL/);assert.match(query,/AS accounts/);
});
