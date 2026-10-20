const path=require('node:path');
const root=path.resolve(__dirname,'..');
const req=require('node:module').createRequire(path.join(root,'package.json'));
const test=require('node:test'),assert=require('node:assert/strict');
const {validateRegisterHrInput:validate}=req('./src/modules/auth/auth.validation');
const {AuthService}=req('./src/modules/auth/auth.service');
const {AuthRepository}=req('./src/modules/auth/auth.repository');
const {verifyPassword}=req('./src/common/utils/password');
test('HR registration validates, normalizes and rejects privileged fields',()=>{
 assert.deepEqual(validate({email:' HR@Example.com ',roleId:2}),{email:'hr@example.com',roleId:2});
 assert.deepEqual(validate({email:'hr@example.com'}),{email:'hr@example.com'});
 for(const body of [null,[],{}, {email:'bad'}, {email:'a@@b.com'}, {email:'a@b.com',fullName:''},{email:'a@b.com',roleId:'2'},...['password','status','employeeId','fullName'].map(k=>({email:'a@b.com',[k]:1}))])assert.throws(()=>validate(body),e=>e.statusCode===400);
});
function setup(actor={role:'ADMIN',status:'ACTIVE'},fail=false){
 let saved=false,hash,mail;
 const repository={findCurrentUserById:async()=>actor,createHrAccount:async(id,input,password)=>{saved=true;hash=password;return{id:7,...input,role:'HR',roleId:2,status:'IN_PROCESS',employeeId:null}}};
 const service=new AuthService({authRepository:repository,initialPassword:'Temporary-test-123!',mailTransporter:{sendMail:async m=>{assert.ok(saved);mail=m;if(fail)throw Error('SMTP down');return{accepted:[m.to]}}}});
 return{service,repository,saved:()=>saved,hash:()=>hash,mail:()=>mail};
}
test('only live ACTIVE ADMIN may create HR',async()=>{
 for(const actor of [null,{role:'HR',status:'ACTIVE'},{role:'EMPLOYEE',status:'ACTIVE'},{role:'ADMIN',status:'INACTIVE'}]){
  const x=setup(actor);await assert.rejects(x.service.registerHr({actorId:1,input:{email:'hr@example.com'}}),e=>e.statusCode===403);assert.equal(x.saved(),false);
 }
});
test('creation hashes password, keeps IN_PROCESS, mails after persistence and hides secrets',async()=>{
 const x=setup();const result=await x.service.registerHr({actorId:1,input:validate({email:'hr@example.com'})});
 assert.equal(result.status,'IN_PROCESS');assert.equal(result.employeeId,null);assert.equal(result.emailDelivery,'SENT');
 assert.ok(await verifyPassword('Temporary-test-123!',x.hash()));assert.equal(JSON.stringify(result).includes(x.hash()),false);assert.equal(JSON.stringify(result).includes('Temporary-test-123!'),false);assert.ok(x.mail().text.includes('Temporary-test-123!'));
});
test('SMTP failure reports saved account without retry insertion',async()=>{
 const x=setup(undefined,true);const result=await x.service.registerHr({actorId:1,input:{email:'hr@example.com'}});assert.equal(result.emailDelivery,'FAILED');assert.equal(result.status,'IN_PROCESS');assert.ok(result.warning);
});
test('missing password config fails before insertion',async()=>{
 const x=setup();x.service.initialPassword='';await assert.rejects(x.service.registerHr({actorId:1,input:{email:'hr@example.com'}}),e=>e.statusCode===503);assert.equal(x.saved(),false);
});
function repoSetup(options={}){
 const calls=[];const client={release:()=>calls.push('RELEASE'),query:async(sql,args)=>{
 calls.push(sql);
 if(sql.includes('FOR SHARE'))return{rows:[options.actor||{role:'ADMIN',status:'ACTIVE'}]};
 if(sql.includes("name = 'HR'"))return{rows:options.noRole?[]:[{id:2}]};
 if(sql.includes('AS exists'))return{rows:[{exists:!!options.duplicate}]};
 if(sql.includes('INSERT INTO')){if(options.unique)throw Object.assign(Error('duplicate'),{code:'23505'});assert.equal(args[2],null);assert.equal(args[3],2);assert.ok(sql.includes("'IN_PROCESS', NULL"));return{rows:[{id:7,email:args[0],status:'IN_PROCESS',employeeId:null}]};}
 return{rows:[]};}};
 return{repo:new AuthRepository({connect:async()=>client}),calls};
}
test('repository commits HR only with null employee link',async()=>{
 const x=repoSetup();assert.equal((await x.repo.createHrAccount(1,{email:'hr@example.com'},'hash')).role,'HR');assert.ok(x.calls.includes('COMMIT'));assert.equal(x.calls.at(-1),'RELEASE');
});
test('repository rolls back duplicate, wrong role, missing role and disabled admin',async()=>{
 for(const [opts,input,code] of [[{duplicate:true},{},409],[{unique:true},{},409],[{noRole:true},{},503],[{}, {roleId:1},400],[{actor:{role:'ADMIN',status:'INACTIVE'}},{},403]]){
 const x=repoSetup(opts);await assert.rejects(x.repo.createHrAccount(1,{email:'hr@example.com',...input},'hash'),e=>e.statusCode===code);assert.ok(x.calls.includes('ROLLBACK'));assert.equal(x.calls.includes('COMMIT'),false);assert.equal(x.calls.at(-1),'RELEASE');
 }
});
test('new HR must verify emailed OTP and change password before ACTIVE login',async()=>{
 const x=setup();let user;let mailText;const records=new Map();
 x.repository.createHrAccount=async(id,input,password)=>{user={id:7,email:input.email,password,roleId:2,status:'IN_PROCESS'};return{id:7,email:input.email,roleId:2,status:user.status,employeeId:null}};
 x.repository.findUserByEmail=async()=>user;x.repository.findUserCredentialsById=async()=>user;
 x.repository.updatePassword=async(id,password,status)=>{user={...user,password,status}};
 x.service.mailTransporter={sendMail:async m=>{mailText=m.text}};
 x.service.ensureRedisConnection=async()=>{};
 x.service.redisClient={set:async(k,v)=>records.set(k,v),get:async k=>records.get(k),del:async k=>records.delete(k),smembers:async()=>[],multi:()=>{const c={exec:async()=>[],del:()=>c,set:()=>c,sadd:()=>c,expire:()=>c};return c;}};
 await x.service.registerHr({actorId:1,input:{email:'hr@example.com'}});
 const first=await x.service.login({email:user.email,password:'Temporary-test-123!'});assert.equal(first.kind,'IN_PROCESS');assert.equal(first.accessToken,undefined);
 const otp=mailText.match(/\b\d{6}\b/)[0];
 await assert.rejects(x.service.changePassword({userId:7,tokenType:'PASSWORD_CHANGE',otp:otp==='000000'?'000001':'000000',newPassword:'Personal-test-456!'}));assert.equal(user.status,'IN_PROCESS');
 await x.service.changePassword({userId:7,tokenType:'PASSWORD_CHANGE',otp,newPassword:'Personal-test-456!'});assert.equal(user.status,'ACTIVE');
 await assert.rejects(x.service.login({email:user.email,password:'Temporary-test-123!'}),e=>e.statusCode===401);
 assert.ok((await x.service.login({email:user.email,password:'Personal-test-456!'})).accessToken);
});
test('HTTP AUTH-05 requires ADMIN access token and returns 201 without secrets',async()=>{
 const express=req('express');const {AuthController}=req('./src/modules/auth/auth.controller');
 const {createAuthRouter}=req('./src/modules/auth/auth.routes');const {errorHandler}=req('./src/common/middleware/error-handler');
 const {createAccessToken,createPasswordChangeToken}=req('./src/common/utils/token');
 const x=setup();const app=express();app.use(express.json());app.use('/api/auth',createAuthRouter(new AuthController(x.service)));app.use(errorHandler);
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const url='http://127.0.0.1:'+server.address().port+'/api/auth/user_register';
 const send=token=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify({email:'hr@example.com'})});
 try{
 assert.equal((await send()).status,401);
 assert.equal((await send(createPasswordChangeToken({id:1,roleId:1,status:'IN_PROCESS'}))).status,401);
 const token=createAccessToken({id:1,roleId:1,status:'ACTIVE'});
 const response=await send(token);assert.equal(response.status,201);const body=await response.json();assert.equal(body.data.status,'IN_PROCESS');assert.equal(body.data.role,'HR');assert.equal(body.data.password,undefined);
 x.repository.findCurrentUserById=async()=>({role:'HR',status:'ACTIVE'});
 assert.equal((await send(createAccessToken({id:2,roleId:2,status:'ACTIVE'}))).status,403);
 }finally{await new Promise(r=>server.close(r));}
});
