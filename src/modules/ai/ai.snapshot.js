const {FEATURES,valid,todayVN}=require('./ai.features');
const {AppError}=require('../../common/errors/app-error');
const COLUMNS=['department','gender','age','hire_date','years_at_company','education_level','monthly_salary','work_hours_per_week','overtime_hours','sick_days','promotions','employee_satisfaction_score'];
function snapshotData(row,metadata=null){
 const features={},missingFeatures=[],invalidFeatures=[],outOfDomainFeatures=[];
 for(const [i,key] of FEATURES.entries()){
  const raw=row[COLUMNS[i]];
  if(raw===null||raw===undefined||raw===''){missingFeatures.push(key);continue;}
  const value=['Department','Gender','Education_Level','Hire_Date'].includes(key)?raw:Number(raw);
  features[key]=value;
  if(!valid(key,value)){
   if(key==='Employee_Satisfaction_Score'&&Number.isFinite(value)&&value>=0&&value<1)outOfDomainFeatures.push(key);
   else invalidFeatures.push(key);
  }
 }
 const capturedAt=new Date(row.snapshot_date).toISOString();
 return {snapshotId:row.id,employee:{id:row.employee_id,employeeCode:row.employeeCode,fullName:row.fullName},
  capturedAt,snapshotDate:todayVN(new Date(capturedAt)),features,missingFeatures,invalidFeatures,outOfDomainFeatures,
  ready:!missingFeatures.length&&!invalidFeatures.length,
  provenance:metadata?.provenance??Object.fromEntries(FEATURES.map((key,i)=>[key,'ai_input.'+COLUMNS[i]+'; chưa ghi nhận nguồn trước snapshot'])),
  period:metadata?.period??null,vndPerUsd:metadata?.vndPerUsd??null,
  dataSource:outOfDomainFeatures.length?'STORED_SNAPSHOT_OUT_OF_DOMAIN_DEMO':metadata?.dataSource??'STORED_SNAPSHOT',
  issues:outOfDomainFeatures.length?['Employee_Satisfaction_Score ngoài thang khảo sát 1–5; giữ nguyên giá trị snapshot để test model demo, không quy đổi.']:[]};
}
async function assertEmployee(client,employeeId,lock=false){
 const {rows}=await client.query(`SELECT e.id,u.id AS user_id FROM employees e JOIN users u ON u.employee_id=e.id WHERE e.id=$1 AND e.employment_status='ACTIVE' AND u.status='ACTIVE' ${lock?'FOR SHARE OF e,u':''}`,[employeeId]);
 if(!rows.length)throw new AppError(404,'Nhân viên không tồn tại hoặc hồ sơ/tài khoản chưa ACTIVE.');
}
function installSnapshots(AiRepository){
 AiRepository.prototype.createSnapshot=async function(actorId,preview){
  const client=await this.pool.connect();
  try{
   await client.query('BEGIN');await this.assertHr(actorId,client,true);await assertEmployee(client,preview.employee.id,true);
   if(FEATURES.some(key=>!valid(key,preview.features[key])))throw new AppError(422,'Chưa đủ 12 feature hợp lệ; không tạo snapshot.');
   const values=FEATURES.map(key=>preview.features[key]);
   const row=(await client.query(`INSERT INTO ai_input(employee_id,snapshot_date,${COLUMNS.join(',')}) VALUES($1,$2,${values.map((_,i)=>'$'+(i+3)).join(',')}) RETURNING id`,[preview.employee.id,preview.capturedAt,...values])).rows[0];
   await client.query(`INSERT INTO audit_logs(user_id,entity_type,entity_id,action,new_value) VALUES($1,'AI_INPUT',$2,'CREATE',$3::jsonb)`,[actorId,row.id,JSON.stringify({...preview,snapshotId:row.id})]);
   await client.query('COMMIT');return row.id;
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
 };
 AiRepository.prototype.readSnapshot=async function(actorId,employeeId,snapshotId,client=this.pool,lock=false){
  await this.assertHr(actorId,client);await assertEmployee(client,employeeId,lock);
  const {rows}=await client.query(`SELECT i.*,i.hire_date::text AS hire_date,e.employee_code AS "employeeCode",e.full_name AS "fullName"
   FROM ai_input i JOIN employees e ON e.id=i.employee_id WHERE i.id=$1 AND i.employee_id=$2 ${lock?'FOR SHARE OF i':''}`,[snapshotId,employeeId]);
  if(!rows[0])throw new AppError(404,'Snapshot không tồn tại hoặc không thuộc nhân viên này.');
  const audit=(await client.query(`SELECT new_value FROM audit_logs WHERE entity_type='AI_INPUT' AND entity_id=$1 AND action='CREATE' ORDER BY id DESC LIMIT 1`,[snapshotId])).rows[0];
  return snapshotData(rows[0],audit?.new_value);
 };
 AiRepository.prototype.snapshots=async function(actorId,employeeId){
  await this.assertHr(actorId);await assertEmployee(this.pool,employeeId);
  const {rows}=await this.pool.query(`SELECT i.*,i.hire_date::text AS hire_date,e.employee_code AS "employeeCode",e.full_name AS "fullName"
    FROM ai_input i JOIN employees e ON e.id=i.employee_id WHERE i.employee_id=$1 ORDER BY i.snapshot_date DESC,i.id DESC`,[employeeId]);
  return rows.map(row=>snapshotData(row));
 };
}
module.exports={snapshotData,installSnapshots};
