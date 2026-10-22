const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../demo/attendance/app.js'),'utf8');
function setup({checkedIn=false,permissionError=false,active=true}={}){
 const nodes=new Map(),calls=[];let gpsCalls=0,checkedOut=false;
 const node=id=>{if(!nodes.has(id))nodes.set(id,{value:id==='email'?'employee@example.com':'password',hidden:false,disabled:false,textContent:'',dataset:{},open:false,events:{},addEventListener(type,fn){this.events[type]=fn},showModal(){this.open=true},close(){this.open=false}});return nodes.get(id)};
 const state=()=>({date:'2026-10-22',workday:true,checkedIn,showCheckInPrompt:!checkedIn,checkedInAtLocal:checkedIn?'22/10/2026, 08:00:00':null,attendance:null,checkedOut,checkedOutAtLocal:checkedOut?'22/10/2026, 17:30:00':null});
 vm.runInNewContext(source,{document:{getElementById:node},window:{isSecureContext:true},navigator:{geolocation:{getCurrentPosition(ok,fail,options){gpsCalls++;assert.equal(options.maximumAge,0);if(permissionError)fail({code:1});else ok({coords:{latitude:10.845106259160106,longitude:106.83894307850271,accuracy:12},timestamp:Date.now()})}}},fetch:async(url,options={})=>{
 calls.push({url,...options});let result;
 if(url==='/api/auth/login')result=active?{accessToken:'fake-access',user:{email:'employee@example.com'}}:{passwordChangeToken:'setup-only'};
 else if(url.endsWith('/today'))result=state();
 else if(url.endsWith('/check-in')){checkedIn=true;result={status:'INSIDE',persisted:true,distanceMeters:0,accuracyMeters:12};}
 else if(url.endsWith('/check-out')){checkedOut=true;result={status:'INSIDE',persisted:true,distanceMeters:0,accuracyMeters:12};}
 else result={};
 return{ok:true,status:200,json:async()=>result};
 },setTimeout:()=>1,clearTimeout:()=>{},Date,JSON,Promise,Math,Error});
 return{node,calls,gpsCalls:()=>gpsCalls,login:()=>node('login').events.submit({preventDefault(){}})};
}
test('login auto opens check-in popup; GPS only requested on button click',async()=>{
 const x=setup();await x.login();assert.equal(x.node('checkDialog').open,true);assert.equal(x.gpsCalls(),0);
 await x.node('gpsButton').events.click();assert.equal(x.gpsCalls(),1);assert.equal(x.node('checkDialog').open,false);
 const call=x.calls.find(c=>c.url.endsWith('/check-in'));assert.deepEqual(JSON.parse(call.body),{latitude:10.845106259160106,longitude:106.83894307850271,accuracyMeters:12,capturedAt:JSON.parse(call.body).capturedAt});assert.equal(call.headers.Authorization,'Bearer fake-access');
 assert.match(x.node('notice').textContent,/thành công/);
});
test('already checked in does not open initial popup or request GPS',async()=>{
 const x=setup({checkedIn:true});await x.login();assert.equal(x.node('checkDialog').open,false);assert.equal(x.gpsCalls(),0);assert.match(x.node('stateTitle').textContent,/đã check-in/);
});
test('permission denial keeps popup retryable without sending attendance',async()=>{
 const x=setup({permissionError:true});await x.login();await x.node('gpsButton').events.click();assert.equal(x.node('checkDialog').open,true);assert.equal(x.node('gpsButton').disabled,false);assert.match(x.node('gpsStatus').textContent,/chưa cho phép/);assert.equal(x.calls.some(c=>c.url.endsWith('/check-in')),false);
});
test('IN_PROCESS login does not access protected attendance or request GPS',async()=>{
 const x=setup({active:false});await x.login();assert.equal(x.calls.length,1);assert.equal(x.gpsCalls(),0);assert.match(x.node('notice').textContent,/chưa kích hoạt/);
});

test('checked-in user can check out once and UI shows completed day without reminders',async()=>{
 const x=setup({checkedIn:true});await x.login();await x.node('openCheck').events.click();assert.match(x.node('dialogTitle').textContent,/Check-out/);
 await x.node('gpsButton').events.click();assert.equal(x.calls.some(c=>c.url.endsWith('/check-out')),true);assert.equal(x.node('openCheck').disabled,true);assert.match(x.node('stateTitle').textContent,/hoàn tất/);
});

function accountHarness({ delayA = false } = {}) {
  const nodes = new Map(), requests = []; let releaseA;
  const node = id => {
    if (!nodes.has(id)) nodes.set(id,{value:'',textContent:'',hidden:false,disabled:false,open:false,dataset:{},events:{},addEventListener(type,fn){this.events[type]=fn},showModal(){this.open=true},close(){this.open=false}});
    return nodes.get(id);
  };
  const states = id => ({ user:{id,employeeId:id},date:'2026-10-22',workday:true,checkedIn:id===1,checkedOut:id===1,showCheckInPrompt:id!==1,checkedInAtLocal:id===1?'08:00':null,checkedOutAtLocal:id===1?'17:30':null,attendance:id===1?{workingMinutes:510,overtimeMinutes:30,attendanceStatus:'PRESENT'}:null });
  vm.runInNewContext(source,{document:{getElementById:node},window:{isSecureContext:true},navigator:{},Date,JSON,Promise,Math,Error,setTimeout:()=>1,clearTimeout:()=>{},fetch:async(url,options)=>{
    requests.push({url,options});assert.equal(options.cache,'no-store');let data;
    if(url==='/api/auth/login'){const id=JSON.parse(options.body).email==='a@example.com'?1:2;data={accessToken:'account-'+id,user:{id,email:id===1?'a@example.com':'b@example.com'}};}
    else if(url.endsWith('/today')){const id=Number(options.headers.Authorization.slice(-1));if(delayA&&id===1)data=await new Promise(r=>releaseA=()=>r(states(1)));else data=states(id);}
    else data={};
    return{ok:true,status:200,json:async()=>data};
  }});
  return{node,requests,release:()=>releaseA(),login:email=>{node('email').value=email;node('password').value='password';return node('login').events.submit({preventDefault(){}})}};
}
test('switching completed account A to new account B clears checkout and opens check-in',async()=>{
  const x=accountHarness();await x.login('a@example.com');assert.equal(x.node('openCheck').textContent,'Đã check-out');
  await x.node('logout').events.click();assert.equal(x.node('checkoutTime').textContent,'');
  await x.login('b@example.com');assert.equal(x.node('welcome').textContent,'b@example.com');assert.equal(x.node('openCheck').textContent,'Check-in');assert.equal(x.node('openCheck').disabled,false);assert.equal(x.node('checkDialog').open,true);assert.equal(x.node('checkoutTime').textContent,'Chưa check-out');assert.equal(x.node('working').textContent,'0 phút');
  assert.equal(x.requests.filter(r=>r.url.endsWith('/today')).at(-1).options.headers.Authorization,'Bearer account-2');
});
test('delayed attendance response from A cannot overwrite account B',async()=>{
  const x=accountHarness({delayA:true});const first=x.login('a@example.com');
  for(let i=0;i<8;i++)await Promise.resolve();
  await x.node('logout').events.click();await x.login('b@example.com');x.release();await first;
  assert.equal(x.node('welcome').textContent,'b@example.com');assert.equal(x.node('openCheck').textContent,'Check-in');assert.equal(x.node('checkoutTime').textContent,'Chưa check-out');
});
