const {randomUUID}=require('node:crypto');
const {AppError}=require('../../common/errors/app-error');
const {transaction,writeAudit,recordChange}=require('../audit_logs/audit.repository');
const {todayInVietnam}=require('../attendance/attendance-calendar');
const shift=(date,days)=>new Date(Date.parse(date+'T00:00:00Z')+days*86400000).toISOString().slice(0,10);
const assignmentColumns='id,employee_id,schedule_id,effective_from::text,effective_to::text';
const intersects=(row,start,end)=>row.effective_from<=(end||'9999-12-31')&&(row.effective_to===null||row.effective_to>=start);
class ScheduleDefaults {
 constructor(pool,{defaultStore=null,clock=()=>new Date()}={}){this.pool=pool;this.store=defaultStore;this.clock=clock;}
 today(){return todayInVietnam(this.clock());}
 async lock(client){await client.query('SELECT pg_advisory_xact_lock(74123, 1)');}
 async pending(client=this.pool){
  if(!this.store)return null;
  const existing=await this.store.get();if(existing)return existing;
  // Rebuild a lost Redis command from its committed audit event, not from a
  // schedule name or from guesses about an employee's assignment dates.
  const {rows}=await client.query(`SELECT a.new_value->'scheduled_default' AS pending,s.is_default
   FROM audit_logs a JOIN work_schedules s ON s.id=a.entity_id
   WHERE a.entity_type='work_schedules' AND a.new_value ? 'scheduled_default' ORDER BY a.id DESC LIMIT 1`);
  if(!rows[0]||rows[0].is_default)return null;
  try{await this.store.put(rows[0].pending);}catch(error){if(error.statusCode!==409)throw error;}
  return this.store.get();
 }
 async current(client){return (await client.query('SELECT * FROM work_schedules WHERE is_default=TRUE ORDER BY id FOR UPDATE')).rows[0]||null;}
 async createWithin(client,schedule,actorId){
  const {rows}=await client.query(`INSERT INTO work_schedules(name,start_time,end_time,break_start,break_end,working_days,status)
   VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,[schedule.name,schedule.start_time,schedule.end_time,schedule.break_start,schedule.break_end,schedule.working_days,schedule.status]);
  await writeAudit(client,{actorId,entityType:'work_schedules',entityId:rows[0].id,action:'CREATE',newValue:rows[0]});return rows[0];
 }
 async insert(client,employeeId,scheduleId,start,end,actorId=null){
  const {rows}=await client.query(`INSERT INTO employee_schedule_assignments(employee_id,schedule_id,effective_from,effective_to)
   VALUES($1,$2,$3,$4) RETURNING ${assignmentColumns}`,[employeeId,scheduleId,start,end]);
  if(actorId)await writeAudit(client,{actorId,entityType:'employee_schedule_assignments',entityId:rows[0].id,action:'CREATE',newValue:rows[0]});
  else await client.query(`INSERT INTO audit_logs(user_id,entity_type,entity_id,action,new_value)
   VALUES(NULL,'employee_schedule_assignments',$1,'CREATE',$2::jsonb)`,[rows[0].id,JSON.stringify(rows[0])]);
  return rows[0];
 }
 async assignments(client,employeeId){return (await client.query(`SELECT ${assignmentColumns} FROM employee_schedule_assignments WHERE employee_id=$1 ORDER BY effective_from,id FOR UPDATE`,[employeeId])).rows;}
 async used(client,employeeId,start,end){return (await client.query('SELECT id FROM attendance WHERE employee_id=$1 AND work_date>=$2::date AND ($3::date IS NULL OR work_date<=$3::date) LIMIT 1',[employeeId,start,end])).rows.length>0;}
 async remove(client,row,actorId){await client.query('DELETE FROM employee_schedule_assignments WHERE id=$1',[row.id]);await writeAudit(client,{actorId,entityType:'employee_schedule_assignments',entityId:row.id,action:'DELETE',oldValue:row});}
 async end(client,row,end,actorId){const {rows}=await client.query(`UPDATE employee_schedule_assignments SET effective_to=$2::date WHERE id=$1 RETURNING ${assignmentColumns}`,[row.id,end]);await recordChange(client,actorId,'employee_schedule_assignments',row.id,'UPDATE',row,rows[0]);}
 async employees(client,id=null){return (await client.query("SELECT id,hire_date::text FROM employees WHERE employment_status='ACTIVE' AND ($1::integer IS NULL OR id=$1) ORDER BY id FOR UPDATE",[id])).rows;}
 async planMembers(client,previousId,targetId,start,actorId){
  let affected=0,skipped=0,preserved=0;
  for(const employee of await this.employees(client)){
   const from=employee.hire_date>start?employee.hire_date:start;
   const rows=await this.assignments(client,employee.id);
   const privateRows=rows.filter(r=>r.schedule_id!==previousId&&intersects(r,from,null));
   if(privateRows.length)preserved++;
   for(const row of rows.filter(r=>r.schedule_id===previousId&&intersects(r,from,null))){
    const changedFrom=row.effective_from>from?row.effective_from:from;
    if(await this.used(client,employee.id,changedFrom,row.effective_to))throw new AppError(409,'Khoảng lịch mới đã có dữ liệu attendance; không tự thay đổi lịch sử.');
    if(row.effective_from<from)await this.end(client,row,shift(from,-1),actorId);
    else await this.remove(client,row,actorId);
   }
   // Record today's legacy default too, without inventing historical dates.
   const today=this.today();
   if(previousId&&employee.hire_date<=today&&!rows.some(r=>intersects(r,today,today)))await this.insert(client,employee.id,previousId,today,shift(start,-1),actorId);
   // Fill only the gaps around individual schedules; never overwrite them.
   let cursor=from,created=0;
   for(const row of privateRows){
    if(row.effective_from>cursor){await this.insert(client,employee.id,targetId,cursor,shift(row.effective_from,-1),actorId);created++;}
    if(row.effective_to===null){cursor=null;break;}
    const after=shift(row.effective_to,1);if(after>cursor)cursor=after;
   }
   if(cursor){await this.insert(client,employee.id,targetId,cursor,null,actorId);created++;}
   if(created)affected++;else skipped++;
  }
  // Do not assign the new schedule to INACTIVE profiles. Close only their old
  // default tail, so later reactivation cannot resurrect a retired default.
  if(previousId){
   const inactive=await client.query(`SELECT e.id FROM employees e WHERE e.employment_status<>'ACTIVE'
    AND EXISTS(SELECT 1 FROM employee_schedule_assignments a WHERE a.employee_id=e.id AND a.schedule_id=$1
     AND (a.effective_to IS NULL OR a.effective_to>=$2::date)) ORDER BY e.id FOR UPDATE`,[previousId,start]);
   for(const employee of inactive.rows){
    for(const row of (await this.assignments(client,employee.id)).filter(r=>r.schedule_id===previousId&&intersects(r,start,null))){
     const changedFrom=row.effective_from>start?row.effective_from:start;
     if(await this.used(client,employee.id,changedFrom,row.effective_to))throw new AppError(409,'Lịch mặc định cũ có dữ liệu attendance tương lai; cần kiểm tra trước khi đổi.');
     if(row.effective_from<start)await this.end(client,row,shift(start,-1),actorId);else await this.remove(client,row,actorId);
    }
   }
  }
  return {affectedEmployees:affected,skippedEmployees:skipped,preservedIndividualEmployees:preserved};
 }
 async plan(id,actorId,newSchedule=null){
  if(!this.store)throw new AppError(503,'Chưa cấu hình nơi lưu lệnh đổi lịch mặc định.');
  await this.sync();
  let owned=null;
  try{return await transaction(this.pool,async client=>{
   await this.lock(client);
   if(await this.pending(client))throw new AppError(409,'Đã có lịch mặc định chờ áp dụng; chờ đến ngày hiệu lực trước khi đặt tiếp.');
   const previous=await this.current(client);
   const selected=newSchedule?await this.createWithin(client,newSchedule,actorId):(await client.query('SELECT * FROM work_schedules WHERE id=$1 FOR UPDATE',[id])).rows[0];
   if(!selected)throw new AppError(404,'Work schedule not found.');
   if(selected.status!=='ACTIVE')throw new AppError(409,'Lịch mặc định phải ACTIVE.');
   if(selected.is_default)return {...selected,scheduled:false,alreadyDefault:true};
   const effectiveFrom=shift(this.today(),1);
   const counts=await this.planMembers(client,previous?.id||null,selected.id,effectiveFrom,actorId);
   const pending={requestId:randomUUID(),scheduleId:selected.id,previousScheduleId:previous?.id||null,effectiveFrom,actorId};
   await writeAudit(client,{actorId,entityType:'work_schedules',entityId:selected.id,action:'UPDATE',newValue:{scheduled_default:pending}});
   owned=pending;await this.store.put(pending);
   return {...selected,scheduled:true,effective_from:effectiveFrom,effective_to:null,...counts};
  });}catch(error){if(owned)await this.store.clear(owned.requestId).catch(()=>{});throw error;}
 }
 async fillToday(client,date,employeeId=null){
  const current=await this.current(client);if(!current||current.status!=='ACTIVE')return 0;
  let created=0;
  for(const employee of await this.employees(client,employeeId)){
   if(employee.hire_date>date)continue;
   const rows=await this.assignments(client,employee.id);
   if(rows.some(r=>intersects(r,date,date)))continue;
   const next=rows.find(r=>r.effective_from>date);
   await this.insert(client,employee.id,current.id,date,next?shift(next.effective_from,-1):null);created++;
  }
  return created;
 }
 async sync(employeeId=null){
  if(!this.store)return {activated:false,created:0};
  let completed=null;
  const result=await transaction(this.pool,async client=>{
   await this.lock(client);const pending=await this.pending(client);const date=this.today();let activated=false;
   if(pending&&pending.effectiveFrom<=date){
    // Redis is written before COMMIT. Verify the matching SQL audit event after
    // acquiring the same transaction lock, so a crashed/rolled-back plan cannot run.
    const marker=await client.query("SELECT new_value->'scheduled_default'->>'requestId' AS request_id FROM audit_logs WHERE entity_type='work_schedules' AND new_value ? 'scheduled_default' ORDER BY id DESC LIMIT 1");
    if(marker.rows[0]?.request_id!==pending.requestId){completed=pending;}
    else{
     const selected=(await client.query('SELECT * FROM work_schedules WHERE id=$1 FOR UPDATE',[pending.scheduleId])).rows[0];
     if(!selected||selected.status!=='ACTIVE')throw new AppError(409,'Lịch mặc định đang chờ không còn ACTIVE.');
     const previous=await this.current(client);
     if(previous?.id!==selected.id){
      if(previous){const {rows}=await client.query('UPDATE work_schedules SET is_default=FALSE WHERE id=$1 RETURNING *',[previous.id]);await recordChange(client,pending.actorId,'work_schedules',previous.id,'UPDATE',previous,rows[0]);}
      const {rows}=await client.query('UPDATE work_schedules SET is_default=TRUE WHERE id=$1 RETURNING *',[selected.id]);await recordChange(client,pending.actorId,'work_schedules',selected.id,'UPDATE',selected,rows[0]);
     }
     activated=true;completed=pending;
    }
   }
   const created=await this.fillToday(client,date,employeeId);return {activated,created};
  });
  if(completed)await this.store.clear(completed.requestId);
  return result;
 }
 async prepareIndividual(client,employeeId,input){
  const current=await this.current(client),pending=await this.pending(client);
  const defaults=new Set([current?.id,pending?.scheduleId].filter(Boolean));
  if(defaults.has(input.schedule_id))throw new AppError(409,'Đây là lịch mặc định hoặc lịch đang chờ mặc định. Hãy tạo lịch riêng khác.');
  const rows=(await this.assignments(client,employeeId)).filter(r=>intersects(r,input.effective_from,input.effective_to));
  if(rows.some(r=>!defaults.has(r.schedule_id)))throw new AppError(409,'The assignment dates overlap an existing individual schedule.');
  for(const row of rows){
   const from=row.effective_from>input.effective_from?row.effective_from:input.effective_from;
   const end=row.effective_to===null?input.effective_to:input.effective_to===null?row.effective_to:(row.effective_to<input.effective_to?row.effective_to:input.effective_to);
   if(await this.used(client,employeeId,from,end))throw new AppError(409,'Khoảng cần đổi đã có chấm công; không thay đổi lịch đã sử dụng.');
   if(row.effective_from<input.effective_from)await this.end(client,row,shift(input.effective_from,-1),input.actorId);
   else await this.remove(client,row,input.actorId);
   if(input.effective_to!==null&&(row.effective_to===null||row.effective_to>input.effective_to))await this.insert(client,employeeId,row.schedule_id,shift(input.effective_to,1),row.effective_to,input.actorId);
  }
 }
 async createIndividual(schedule,employeeId,input,actorId){
  return transaction(this.pool,async client=>{
   await this.lock(client);
   const employee=(await client.query('SELECT id FROM employees WHERE id=$1 FOR UPDATE',[employeeId])).rows[0];
   if(!employee)throw new AppError(404,'Employee not found.');
   const created=await this.createWithin(client,schedule,actorId);
   await this.prepareIndividual(client,employeeId,{...input,schedule_id:created.id,actorId});
   const assignment=await this.insert(client,employeeId,created.id,input.effective_from,input.effective_to,actorId);
   return {...created,assignment};
  });
 }
}
module.exports={ScheduleDefaults,shift};
