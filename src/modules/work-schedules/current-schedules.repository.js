const {AppError}=require('../../common/errors/app-error');
const {transaction,recordChange}=require('../audit_logs/audit.repository');
const columns='id,name,shift_type,start_time,end_time,break_start,break_end,working_days,status';
class WorkSchedulesRepository {
 constructor(pool){this.pool=pool;}
 async findActor(id){return (await this.pool.query('SELECT r.name AS role,u.status FROM users u JOIN role r ON r.id=u.role_id WHERE u.id=$1',[id])).rows[0]||null;}
 async findAll(){return (await this.pool.query(`SELECT ${columns} FROM work_schedules ORDER BY id`)).rows;}
 async pendingDefault(){return null;}
 async syncDefaults(){return {updated:0};}
 async create(schedule,actorId){return transaction(this.pool,c=>this.insert(c,schedule,actorId));}
 async insert(c,s,actorId){
  await this.checkBreakSchema(c,s);
  const row=(await c.query(`INSERT INTO work_schedules(name,shift_type,start_time,end_time,break_start,break_end,working_days,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${columns}`,[s.name,s.shift_type,s.start_time,s.end_time,s.break_start,s.break_end,s.working_days,s.status])).rows[0];
  await recordChange(c,actorId,'work_schedules',row.id,'CREATE',null,row);return row;
 }
 async update(id,actorId,prepare){return transaction(this.pool,async c=>{
  const old=(await c.query(`SELECT ${columns} FROM work_schedules WHERE id=$1 FOR UPDATE`,[id])).rows[0];if(!old)throw new AppError(404,'Work schedule not found.');
  const assigned=(await c.query('SELECT EXISTS(SELECT 1 FROM employees WHERE work_schedule_id=$1) AS assigned',[id])).rows[0].assigned;
  const patch=prepare(old,assigned),keys=Object.keys(patch);
  await this.checkBreakSchema(c,{...old,...patch});
  const row=(await c.query(`UPDATE work_schedules SET ${keys.map((k,i)=>`${k}=$${i+1}`).join(',')} WHERE id=$${keys.length+1} RETURNING ${columns}`,[...keys.map(k=>patch[k]),id])).rows[0];
  await recordChange(c,actorId,'work_schedules',id,'UPDATE',old,row);return row;
 });}
 async findAssignments(employeeId){
  const row=(await this.pool.query(`SELECT e.id AS employee_id,e.work_schedule_id,s.shift_type,s.name,s.start_time,s.end_time,s.break_start,s.break_end,s.working_days,s.status FROM employees e LEFT JOIN work_schedules s ON s.id=e.work_schedule_id WHERE e.id=$1`,[employeeId])).rows[0];
  if(!row)throw new AppError(404,'Employee not found.');return row.work_schedule_id==null?[]:[row];
 }
 async assign(employeeId,input,actorId){return transaction(this.pool,c=>this.assignUsing(c,employeeId,input.work_schedule_id,actorId));}
 async assignUsing(c,employeeId,scheduleId,actorId){
  const s=(await c.query('SELECT id,status FROM work_schedules WHERE id=$1 FOR SHARE',[scheduleId])).rows[0];if(!s)throw new AppError(404,'Work schedule not found.');if(s.status!=='ACTIVE')throw new AppError(409,'Cannot assign an inactive schedule.');
  const old=(await c.query('SELECT id,work_schedule_id FROM employees WHERE id=$1 FOR UPDATE',[employeeId])).rows[0];if(!old)throw new AppError(404,'Employee not found.');
  const row=(await c.query('UPDATE employees SET work_schedule_id=$2 WHERE id=$1 RETURNING id,work_schedule_id',[employeeId,scheduleId])).rows[0];await recordChange(c,actorId,'employees',employeeId,'UPDATE',old,row);return {employee_id:row.id,work_schedule_id:row.work_schedule_id};
 }
 async createIndividual(schedule,employeeId,_dates,actorId){return transaction(this.pool,async c=>{const s=await this.insert(c,schedule,actorId);return {schedule:s,employee:await this.assignUsing(c,employeeId,s.id,actorId)};});}
 async removeAssignment(employeeId,scheduleId,actorId){return transaction(this.pool,async c=>{
  const old=(await c.query('SELECT id,work_schedule_id FROM employees WHERE id=$1 FOR UPDATE',[employeeId])).rows[0];if(!old)throw new AppError(404,'Employee not found.');if(old.work_schedule_id!==scheduleId)throw new AppError(409,'Current schedule does not match; reload before removing.');
  const row=(await c.query('UPDATE employees SET work_schedule_id=NULL WHERE id=$1 RETURNING id,work_schedule_id',[employeeId])).rows[0];await recordChange(c,actorId,'employees',employeeId,'UPDATE',old,row);return row;
 });}
 async setDefault(){throw new AppError(410,'Default scheduling was retired. Assign work_schedule_id to each employee.');}
 async checkBreakSchema(c,s){
  if(s.break_start==null&&s.break_end==null){
   const result=(await c.query("SELECT bool_or(attnotnull) AS requires_break FROM pg_attribute WHERE attrelid=to_regclass('work_schedules') AND attname IN ('break_start','break_end') AND NOT attisdropped")).rows[0];
   if(result?.requires_break)throw new AppError(503,'Database still requires break times. Table owner must run scripts/work-schedules-optional-break.sql before creating a shift without a break.');
  }
 }
 async createDefault(){return this.setDefault();}
}
module.exports={WorkSchedulesRepository};
