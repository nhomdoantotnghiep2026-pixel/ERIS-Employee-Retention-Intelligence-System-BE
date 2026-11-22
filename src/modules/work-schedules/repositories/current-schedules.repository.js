const {normalizeShiftType}=require('../../../common/validation/shift-type');
const {AppError}=require('../../../common/errors/app-error');
const {transaction,recordChange}=require('../../audit_logs/repositories/audit.repository');
const columns='id,name,shift_type,start_time,end_time,break_start,break_end,working_days,status';
class WorkSchedulesRepository {
 constructor(pool){this.pool=pool;}
 async findActor(id){return (await this.pool.query('SELECT r.name AS role,u.status FROM users u JOIN role r ON r.id=u.role_id WHERE u.id=$1',[id])).rows[0]||null;}
 async findAll(){return (await this.pool.query(`SELECT ${columns} FROM work_schedules ORDER BY id`)).rows;}
 async create(schedule,actorId){return transaction(this.pool,c=>this.insert(c,schedule,actorId));}
 async requireHr(c,actorId){
  const {rows}=await c.query("SELECT u.id FROM users u JOIN role r ON r.id=u.role_id WHERE u.id=$1 AND u.status='ACTIVE' AND r.name='HR' FOR SHARE OF u,r",[actorId]);
  if(!rows.length)throw new AppError(403,'Only active HR users can manage work schedules.');
 }
 async shiftLock(c){await c.query("SELECT pg_advisory_xact_lock(hashtext('work-schedules:shift-type-write'))");}
 async uniqueShift(c,value,exclude=null){
  const normalized=normalizeShiftType(value);
  const {rows}=await c.query('SELECT id FROM work_schedules WHERE upper(btrim(shift_type))=$1 AND ($2::integer IS NULL OR id<>$2) LIMIT 1',[normalized,exclude]);
  if(rows.length)throw new AppError(409,'shift_type already exists (case-insensitive), including INACTIVE schedules.');
  return normalized;
 }
 async insert(c,s,actorId){
  await this.requireHr(c,actorId);await this.shiftLock(c);
  s={...s,shift_type:await this.uniqueShift(c,s.shift_type)};
  await this.checkBreakSchema(c,s);
  const row=(await c.query(`INSERT INTO work_schedules(name,shift_type,start_time,end_time,break_start,break_end,working_days,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${columns}`,[s.name,s.shift_type,s.start_time,s.end_time,s.break_start,s.break_end,s.working_days,s.status])).rows[0];
  await recordChange(c,actorId,'work_schedules',row.id,'CREATE',null,row);return row;
 }
 async update(id,actorId,prepare){return transaction(this.pool,async c=>{
  await this.requireHr(c,actorId);await this.shiftLock(c);
  const old=(await c.query(`SELECT ${columns} FROM work_schedules WHERE id=$1 FOR UPDATE`,[id])).rows[0];if(!old)throw new AppError(404,'Work schedule not found.');
  const patch=prepare(old),keys=Object.keys(patch);
  if(Object.hasOwn(patch,'shift_type'))patch.shift_type=await this.uniqueShift(c,patch.shift_type,id);
  await this.checkBreakSchema(c,{...old,...patch});
  const row=(await c.query(`UPDATE work_schedules SET ${keys.map((k,i)=>`${k}=$${i+1}`).join(',')} WHERE id=$${keys.length+1} RETURNING ${columns}`,[...keys.map(k=>patch[k]),id])).rows[0];
  await recordChange(c,actorId,'work_schedules',id,'UPDATE',old,row);return row;
 });}
 async findAssignments(employeeId){
  const row=(await this.pool.query(`SELECT e.id AS employee_id,e.work_schedule_id,s.shift_type,s.name,s.start_time,s.end_time,s.break_start,s.break_end,s.working_days,s.status FROM employees e LEFT JOIN work_schedules s ON s.id=e.work_schedule_id WHERE e.id=$1`,[employeeId])).rows[0];
  if(!row)throw new AppError(404,'Employee not found.');return row.work_schedule_id==null?[]:[row];
 }
 async checkBreakSchema(c,s){
  if(s.break_start==null&&s.break_end==null){
   const result=(await c.query("SELECT bool_or(attnotnull) AS requires_break FROM pg_attribute WHERE attrelid=to_regclass('work_schedules') AND attname IN ('break_start','break_end') AND NOT attisdropped")).rows[0];
   if(result?.requires_break)throw new AppError(503,'The existing database requires break times. Ask the schema owner before creating a no-break shift.');
  }
 }
}
module.exports={WorkSchedulesRepository};
