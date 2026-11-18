const test=require('node:test'),assert=require('node:assert/strict'),ExcelJS=require('exceljs');
const {HolidayService,createHolidayRouter,input,todayVN,holidayId}=require('../src/modules/holidays/holidays');
function fixture(){
 let now=new Date('2026-11-18T05:00:00Z');
 const state={rows:[],audits:[],next:1,queries:[],rejectAudit:false};let backup;
 const pool={async query(sql,args=[]){state.queries.push(sql);assert(!/CREATE (?:TEMP )?TABLE|ALTER TABLE|DROP TABLE|TRUNCATE/.test(sql),'No real schema changes or TEMP tables');
  if(sql==='BEGIN'){backup=structuredClone({rows:state.rows,audits:state.audits,next:state.next});return {rows:[]};}
  if(sql==='ROLLBACK'){Object.assign(state,backup);return {rows:[]};}
  if(sql==='COMMIT'||sql.startsWith('SET LOCAL')||sql.startsWith('SELECT pg_advisory'))return {rows:[]};
  if(sql.includes('SELECT u.id FROM users'))return {rows:[1,2].includes(args[0])?[{id:args[0]}]:[]};
  if(sql.includes('FROM attendance'))return {rows:[]};
  if(sql.startsWith('SELECT')&&sql.includes('FROM holidays')){
   let rows=structuredClone(state.rows);
   if(sql.includes('WHERE id=$1'))rows=rows.filter(r=>r.id===args[0]);
   else if(sql.includes("WHERE status='ACTIVE'"))rows=rows.filter(r=>r.status==='ACTIVE');
   else if(sql.includes("WHERE ($1='ALL'")){const [status,from,to,limit,offset]=args;rows=rows.filter(r=>(status==='ALL'||r.status===status)&&(!from||r.end_date>=from)&&(!to||r.start_date<=to)).sort((a,b)=>a.start_date.localeCompare(b.start_date)||a.id-b.id).slice(offset,offset+limit);}
   return {rows};
  }
  if(sql.startsWith('INSERT INTO holidays')){const [user_id,name,start_date,end_date,description]=args;const row={id:state.next++,user_id,name,start_date,end_date,description,status:'ACTIVE'};state.rows.push(row);return {rows:[structuredClone(row)]};}
  if(sql.startsWith('UPDATE holidays SET name=')){const r=state.rows.find(r=>r.id===args[0]);Object.assign(r,{name:args[1],start_date:args[2],end_date:args[3],description:args[4]});return {rows:[structuredClone(r)]};}
  if(sql.startsWith("UPDATE holidays SET status='INACTIVE'")){const r=state.rows.find(r=>r.id===args[0]);r.status='INACTIVE';return {rows:[structuredClone(r)]};}
  if(sql.startsWith('INSERT INTO audit_logs')){if(state.rejectAudit)throw Error('audit unavailable');state.audits.push({actor:args[0],action:args[3],before:args[4],after:args[5]});return {rows:[]};}
  throw Error('Unexpected fake SQL: '+sql);
 },async connect(){return {query:(...args)=>pool.query(...args),release(){}};}};
 return {state,pool,service:new HolidayService(pool,{clock:()=>now}),setTime:value=>{now=new Date(value);}};
}
const good={name:'Future holiday',start_date:'2026-11-20',end_date:'2026-11-21',description:'Company holiday'};
async function workbook(rows){const w=new ExcelJS.Workbook(),s=w.addWorksheet('Holidays');s.addRow(['name','start_date','end_date','description']);rows.forEach(r=>s.addRow(r));return {originalname:'holidays.xlsx',buffer:Buffer.from(await w.xlsx.writeBuffer())};}
test('dates require full YYYY-MM-DD and real calendar dates, including leap years',()=>{
 for(const d of ['2026','2026-11','18/11/2026','2026-1-01','2026-02-29','2026-04-31','0000-01-01','2026-11-20T00:00:00Z'])assert.throws(()=>input({...good,start_date:d}),e=>e.statusCode===400);
 assert.equal(input({...good,start_date:'2028-02-29',end_date:'2028-02-29'}).start_date,'2028-02-29');
 for(const id of [0,-1,'1.5','1e2','01','2147483648'])assert.throws(()=>holidayId(id),e=>e.statusCode===400);
});
test('manual creation only accepts future Vietnam days, including the midnight boundary',async()=>{
 const {service,state,setTime}=fixture();
 for(const date of ['2026-11-17','2026-11-18'])await assert.rejects(service.create(1,{...good,start_date:date}),e=>e.statusCode===400);assert.equal(state.rows.length,0);
 await service.create(1,{...good,start_date:'2026-11-19',end_date:'2026-11-19'});
 setTime('2026-11-18T17:00:00Z');assert.equal(todayVN(new Date('2026-11-18T17:00:00Z')),'2026-11-19');
 await assert.rejects(service.create(1,{...good,start_date:'2026-11-19'}),e=>e.statusCode===400);
});
test('PUT/PATCH retain creator, audit the editor, reject overlap and forged/empty bodies',async()=>{
 const {service,state}=fixture(),a=await service.create(1,good);await service.create(1,{...good,name:'Other',start_date:'2026-11-23',end_date:'2026-11-23'});
 const renamed=await service.update(2,a.data.id,{name:'Renamed'},true);assert.equal(renamed.data.name,'Renamed');assert.equal(renamed.data.user_id,1);assert.equal(state.audits.at(-1).actor,2);assert.equal(state.audits.at(-1).action,'UPDATE');
 await assert.rejects(service.update(1,a.data.id,{start_date:'2026-11-23',end_date:'2026-11-23'},true),e=>e.statusCode===409);
 await assert.rejects(service.update(1,a.data.id,{start_date:'2026-11-18'},true),e=>e.statusCode===400);
 await assert.rejects(service.update(1,a.data.id,{start_date:'2026-11-22'},true),e=>e.statusCode===400);
 for(const b of [{},{user_id:2},{status:'INACTIVE'},{id:99},{name:null}])await assert.rejects(service.update(1,a.data.id,b,true),e=>e.statusCode===400);
 await assert.rejects(service.update(1,a.data.id,{name:'Missing dates'}),e=>e.statusCode===400);
 const replaced=await service.update(2,a.data.id,{...good,name:'Full replacement',description:null});assert.equal(replaced.data.description,null);assert.equal(replaced.data.user_id,1);
});
test('started and ongoing holidays cannot be changed or removed; future deletion is soft and idempotent',async()=>{
 const {service,state,setTime}=fixture();const created=await service.create(1,good);
 const gone=await service.remove(2,created.data.id);assert.equal(gone.data.status,'INACTIVE');assert.equal(state.rows.length,1);assert.equal(state.audits.at(-1).actor,2);assert.equal(state.audits.at(-1).action,'DELETE');const count=state.audits.length;assert.equal((await service.remove(1,created.data.id)).already_inactive,true);assert.equal(state.audits.length,count);
 await assert.rejects(service.update(1,created.data.id,{name:'No'},true),e=>e.statusCode===409);
 const next=await service.create(1,{...good,name:'New active'});setTime('2026-11-20T00:00:00+07:00');
 await assert.rejects(service.remove(1,next.data.id),e=>e.statusCode===409);await assert.rejects(service.update(1,next.data.id,{start_date:'2026-12-01',end_date:'2026-12-01'},true),e=>e.statusCode===409);
 setTime('2026-12-01T00:00:00+07:00');await assert.rejects(service.remove(1,next.data.id),e=>e.statusCode===409);
});
test('list/detail handle status, pagination, date filters, 404 and HR authorization',async()=>{
 const {service}=fixture(),a=await service.create(1,good);await service.create(1,{...good,start_date:'2026-11-23',end_date:'2026-11-23'});await service.remove(1,a.data.id);
 assert.equal((await service.list(1)).data.length,1);assert.equal((await service.list(1,{status:'INACTIVE'})).data.length,1);assert.equal((await service.list(1,{status:'ALL',limit:'1',offset:'1'})).data.length,1);assert.equal((await service.detail(1,a.data.id)).data.status,'INACTIVE');
 assert.equal((await service.list(1,{from:'2026-11-24'})).data.length,0);
 for(const q of [{status:'BAD'},{limit:'0'},{limit:'201'},{offset:'-1'},{from:'2026-11'},{from:'2026-12-01',to:'2026-11-01'},{user_id:'1'}])await assert.rejects(service.list(1,q),e=>e.statusCode===400);
 for(const fn of [()=>service.detail(1,999),()=>service.remove(1,999),()=>service.update(1,999,good)])await assert.rejects(fn(),e=>e.statusCode===404);
 for(const fn of [()=>service.list(3),()=>service.detail(3,1),()=>service.create(3,good),()=>service.remove(3,1),()=>service.update(3,1,good)])await assert.rejects(fn(),e=>e.statusCode===403);
});
test('import rejects past/today, partial dates and time cells per row; confirm rechecks future dates',async()=>{
 const {service,state,setTime}=fixture();const file=await workbook([['Today','2026-11-18','2026-11-18',''],['Partial','2026-11','2026-11-20',''],['Clock',new Date('2026-11-20T08:00:00Z'),'2026-11-20',''],['Good','2026-11-20','2026-11-20','']]);
 const p=await service.import(1,file);assert.equal(p.failed,3);assert.equal(p.valid,1);assert.equal(state.rows.length,0);
 await assert.rejects(service.import(1,file,true,p.fingerprint),e=>e.statusCode===422);assert.equal(state.rows.length,0);
 const tomorrow=await workbook([['Tomorrow','2026-11-19','2026-11-19','']]);const ready=await service.import(1,tomorrow);assert.equal(ready.valid,1);setTime('2026-11-19T00:01:00+07:00');await assert.rejects(service.import(1,tomorrow,true,ready.fingerprint),e=>e.statusCode===422);assert.equal(state.rows.length,0);
});
test('audit failure rolls back create, edit and soft delete in fake transactions',async()=>{
 const {service,state}=fixture();const a=await service.create(1,good);state.rejectAudit=true;
 await assert.rejects(service.update(1,a.data.id,{name:'Do not persist'},true),/audit unavailable/);assert.equal(state.rows[0].name,good.name);
 await assert.rejects(service.remove(1,a.data.id),/audit unavailable/);assert.equal(state.rows[0].status,'ACTIVE');
 await assert.rejects(service.create(1,{...good,start_date:'2026-12-01',end_date:'2026-12-01'}),/audit unavailable/);assert.equal(state.rows.length,1);
});
test('HTTP CRUD exposes authenticated routes with strict body/date validation',async()=>{
 const express=require('express'),app=express(),{pool,service}=fixture();app.use(express.json());app.use('/api/holidays',createHolidayRouter({pool,service,authenticate:(req,res,next)=>{if(!req.headers.authorization)return res.sendStatus(401);req.auth={userId:Number(req.headers.authorization)};next();}}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}/api/holidays`;
 try{const call=(method,path='',body,id=1)=>fetch(base+path,{method,headers:{Authorization:String(id),'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});assert.equal((await fetch(base)).status,401);assert.equal((await call('GET','',undefined,3)).status,403);
 const c=await call('POST','',good);assert.equal(c.status,200);const id=(await c.json()).data.id;assert.equal((await call('GET','/'+id)).status,200);assert.equal((await call('GET','/999')).status,404);
 assert.equal((await call('PATCH','/'+id,{name:'Partial'})).status,200);assert.equal((await call('PUT','/'+id,{...good,name:'Full'})).status,200);assert.equal((await call('PATCH','/'+id,{})).status,400);
 assert.equal((await call('DELETE','/'+id,{user_id:2})).status,400);assert.equal((await call('DELETE','/'+id)).status,200);assert.equal((await call('GET','?status=INACTIVE')).status,200);
 }finally{await new Promise(r=>server.close(r));}
});
