const {AppError}=require('../../common/errors/app-error');
const {validateAttendanceId}=require('./attendance.validation');
const {transaction,writeAudit}=require('../audit_logs/audit.repository');
function reasonFrom(body){
 if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>k!=='cancellation_reason')||typeof body.cancellation_reason!=='string')throw new AppError(400,'Provide only cancellation_reason as text.');
 const reason=body.cancellation_reason.trim();
 if(!reason||reason.length>1000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(reason))throw new AppError(400,'cancellation_reason is required, maximum 1000 characters; control characters are not accepted.');
 return reason;
}
async function cancelAttendance(pool,actorId,rawId,body){
 const id=validateAttendanceId(rawId),reason=reasonFrom(body);
 return transaction(pool,async c=>{
  const actor=(await c.query("SELECT u.id FROM users u JOIN role r ON r.id=u.role_id WHERE u.id=$1 AND u.status='ACTIVE' AND r.name='HR' FOR SHARE OF u,r",[actorId])).rows[0];
  if(!actor)throw new AppError(403,'Only ACTIVE HR can cancel attendance.');
  const schema=(await c.query("SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('attendance') AND attname='cancelled_at' AND NOT attisdropped")).rows;
  if(!schema.length)throw new AppError(503,'Run scripts/attendance-cancellation-migration.sql as table owner first.');
  // Same employee row lock as import prevents cancel/reimport races.
  const owner=(await c.query('SELECT employee_id FROM attendance WHERE id=$1',[id])).rows[0];
  if(!owner)throw new AppError(404,'Attendance record not found.');
  await c.query('SELECT id FROM employees WHERE id=$1 FOR UPDATE',[owner.employee_id]);
  const before=(await c.query('SELECT * FROM attendance WHERE id=$1 FOR UPDATE',[id])).rows[0];
  if(before.record_status==='CANCELLED')return {data:before,cancelled:false,message:'Record was already cancelled; original cancellation is preserved.'};
  if(before.record_status!=='ACTIVE')throw new AppError(409,'Only ACTIVE attendance can be cancelled.');
  const after=(await c.query(`UPDATE attendance SET record_status='CANCELLED',cancellation_reason=$2,cancelled_by=$3,cancelled_at=CURRENT_TIMESTAMP,
   updated_at=CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Ho_Chi_Minh' WHERE id=$1 RETURNING *`,[id,reason,actorId])).rows[0];
  await writeAudit(c,{actorId,entityType:'attendance',entityId:id,action:'CANCEL',oldValue:before,newValue:after});
  return {data:after,cancelled:true,message:'Attendance cancelled. Import a new record to replace it.'};
 });
}
module.exports={cancelAttendance,reasonFrom};
