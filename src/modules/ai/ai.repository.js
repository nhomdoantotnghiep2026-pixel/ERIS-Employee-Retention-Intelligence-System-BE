const {AppError}=require('../../common/errors/app-error');
const {assess}=require('./ai.assessment');
const {AiInputRepository}=require('../ai_input/ai-input.repository');
const {FEATURES}=require('../ai_input/ai-input.features');
class AiRepository extends AiInputRepository {
  async save(actorId,preview,result) {
    result=assess(result);
    const client=await this.pool.connect();
    try {
      await client.query('BEGIN');
      await this.assertHr(actorId,client,true);
      const employeeId=preview.employee.id;
      const active=await client.query(`SELECT e.id,u.id AS user_id FROM employees e JOIN users u ON u.employee_id=e.id
        WHERE e.id=$1 AND e.employment_status='ACTIVE' AND u.status='ACTIVE' FOR SHARE OF e,u`,[employeeId]);
      if(!active.rows.length) throw new AppError(409,'Nhân viên không còn ACTIVE; không lưu kết quả.');
      const snapshot={id:preview.snapshotId};
      if(!snapshot.id)throw new AppError(409,'Phải tạo hoặc chọn snapshot trước khi lưu dự đoán.');
      const current=await this.readSnapshot(actorId,employeeId,snapshot.id,client,true);
      if(FEATURES.some(key=>current.features[key]!==preview.features[key]))throw new AppError(409,'Snapshot đã bị thay đổi trong lúc chạy model. Hãy chạy lại.');
      const prediction=(await client.query(`INSERT INTO prediction_results(employee_id,snapshot_id,attrition_probability,risk_level,prediction_label)
        VALUES($1,$2,$3,$4,$5) RETURNING id`,[employeeId,snapshot.id,result.score,result.riskLevel,result.predictionLabel])).rows[0];
      const ranked=Object.entries(result.contributions).sort((a,b)=>Math.abs(b[1])-Math.abs(a[1]));
      for(const [i,[key,value]] of ranked.entries()) await client.query(`INSERT INTO explainable(prediction_result_id,feature_name,feature_value,impact_value,impact_direction,rank_order) VALUES($1,$2,$3,$4,$5,$6)`,[prediction.id,key,String(preview.features[key]),value,value>0?'INCREASE':value<0?'DECREASE':'NEUTRAL',i+1]);
      await client.query(`INSERT INTO audit_logs(user_id,entity_type,entity_id,action,new_value) VALUES($1,'AI_PREDICTION',$2,'CREATE',$3::jsonb)`,[actorId,prediction.id,JSON.stringify({model:result,preview})]);
      await client.query('COMMIT');
      return {predictionId:prediction.id,snapshotId:snapshot.id};
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }
  async results(actorId,employeeId) {
    await this.assertHr(actorId);
    const {rows}=await this.pool.query(`SELECT p.id AS "predictionId",p.snapshot_id AS "snapshotId",p.created_at AS "createdAt"
      FROM prediction_results p
      WHERE p.employee_id=$1 AND EXISTS (
        SELECT 1 FROM audit_logs a
        WHERE a.entity_type='AI_PREDICTION' AND a.entity_id=p.id AND a.action='CREATE'
      )
      ORDER BY p.created_at DESC,p.id DESC`,[employeeId]);
    return rows;
  }
  async result(actorId,resultId) {
    await this.assertHr(actorId);
    const {rows}=await this.pool.query(`SELECT p.id,p.snapshot_id AS "snapshotId",p.created_at AS "createdAt",a.new_value AS metadata
      FROM prediction_results p JOIN audit_logs a ON a.entity_type='AI_PREDICTION' AND a.entity_id=p.id AND a.action='CREATE'
      WHERE p.id=$1 ORDER BY a.id DESC LIMIT 1`,[resultId]);
    if(!rows[0]) throw new AppError(404,'Không tìm thấy kết quả AI service đã lưu.');
    const r=rows[0];return {saved:true,predictionId:r.id,snapshotId:r.snapshotId,createdAt:r.createdAt,...r.metadata};
  }
}
module.exports={AiRepository};
