const { AppError } = require('../../common/errors/app-error');
const { DEMO_VERSION, DEMO_POLICIES, DEMO_EXPLANATIONS } = require('./policy-demo.data');
const policyColumns=`id,code,name,description,target_factor AS "targetFactor",status,created_at AS "createdAt",updated_at AS "updatedAt"`;
const source = version => version===DEMO_VERSION?'DEMO_FIXED':'STORED';

class PolicyDemoRepository {
  constructor(pool) {this.pool=pool;}
  async assertHr(client,actorId,lock=false) {
    const {rows}=await client.query(`SELECT u.id FROM users u JOIN role r ON r.id=u.role_id
      WHERE u.id=$1 AND u.status='ACTIVE' AND r.name='HR' ${lock?'FOR SHARE OF u':''}`,[actorId]);
    if (!rows[0]) throw new AppError(403,'Chỉ HR ACTIVE được xem kết quả dự đoán và chính sách.');
  }
  async createDemo(actorId,employeeIds) {
    const client=await this.pool.connect();
    try {
      await client.query('BEGIN');
      await this.assertHr(client,actorId,true);
      const {rows:employees}=await client.query(`SELECT e.id FROM employees e WHERE e.id=ANY($1::int[])
        AND e.employment_status='ACTIVE' AND EXISTS(SELECT 1 FROM users u WHERE u.employee_id=e.id AND u.status='ACTIVE')
        ORDER BY e.id FOR SHARE OF e`,[employeeIds]);
      if (employees.length!==employeeIds.length) throw new AppError(409,'Mỗi nhân viên được chọn phải tồn tại và có hồ sơ/tài khoản ACTIVE.');
      const policies=[];
      for(const policy of DEMO_POLICIES) {
        await client.query(`INSERT INTO retention_policies(code,name,description,target_factor,status)
          VALUES($1,$2,$3,$4,'ACTIVE') ON CONFLICT(code) DO NOTHING`,
        [policy.code,policy.name,policy.description,policy.targetFactor]);
        const {rows}=await client.query(`SELECT ${policyColumns} FROM retention_policies WHERE code=$1 FOR SHARE`,[policy.code]);
        if(rows[0].status!=='ACTIVE'||rows[0].targetFactor!==policy.targetFactor) {
          throw new AppError(409,`Chính sách ${policy.code} không ACTIVE hoặc đã đổi yếu tố áp dụng.`);
        }
        policies.push(rows[0]);
      }
      const {rows:runs}=await client.query(`INSERT INTO model_run(name,period_start,period_end,status,total_employees,model_version,created_by,started_at,completed_at)
        VALUES('Demo kết quả và policy cố định',(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,
          (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,'COMPLETED',$1,$2,$3,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
        RETURNING id,name,status,model_version AS "modelVersion",total_employees AS "totalEmployees"`,[employees.length,DEMO_VERSION,actorId]);
      const resultIds=[];
      for(const employee of employees) {
        // Only the two illustrative features are populated. No real model is invoked.
        const {rows:inputs}=await client.query(`INSERT INTO ai_input(employee_id,overtime_hours,employee_satisfaction_score)
          VALUES($1,24,2.0) RETURNING id`,[employee.id]);
        const {rows:predictions}=await client.query(`INSERT INTO prediction_results
          (prediction_run_id,employee_id,snapshot_id,attrition_probability,risk_level,prediction_label)
          VALUES($1,$2,$3,0.78,'HIGH',true) RETURNING id`,[runs[0].id,employee.id,inputs[0].id]);
        const predictionId=predictions[0].id;
        for(const explanation of DEMO_EXPLANATIONS) {
          await client.query(`INSERT INTO explainable(prediction_result_id,feature_name,feature_value,impact_value,impact_direction,rank_order)
            VALUES($1,$2,$3,$4,$5,$6)`,[predictionId,explanation.featureName,explanation.featureValue,explanation.impactValue,explanation.impactDirection,explanation.rankOrder]);
        }
        for(let i=0;i<policies.length;i++) {
          await client.query(`INSERT INTO policy_recommendations(prediction_result_id,policy_id,reason,priority,status)
            VALUES($1,$2,$3,$4,'SUGGESTED')`,[predictionId,policies[i].id,DEMO_POLICIES[i].reason,DEMO_POLICIES[i].priority]);
        }
        resultIds.push(predictionId);
      }
      const results=[];
      for(const id of resultIds) results.push(await this.readPrediction(client,id));
      await client.query('COMMIT');
      return {dataSource:'DEMO_FIXED',modelInvoked:false,
        explanationScale:'DEMO_ILLUSTRATIVE_NOT_SHAP',
        message:'Kết quả cố định để thiết kế giao diện và policy, không phải đánh giá thực tế của nhân viên.',
        run:runs[0],policies,results};
    } catch(error) {await client.query('ROLLBACK');throw error;}
    finally {client.release();}
  }
  async policies(actorId,id) {
    await this.assertHr(this.pool,actorId);
    const {rows}=await this.pool.query(`SELECT ${policyColumns} FROM retention_policies ${id?'WHERE id=$1':''} ORDER BY id`,id?[id]:[]);
    if(id && !rows[0]) throw new AppError(404,'Không tìm thấy chính sách.');
    return {data:id?rows[0]:rows};
  }
  async readRecommendations(client,where='',values=[]) {
    const {rows}=await client.query(`SELECT r.id,r.prediction_result_id AS "predictionResultId",r.reason,r.priority,r.status,r.created_at AS "createdAt",
      p.id AS "policyId",p.code,p.name,p.description,p.target_factor AS "targetFactor",p.status AS "policyStatus",
      e.id AS "employeeId",e.employee_code AS "employeeCode",e.full_name AS "fullName",
      pr.attrition_probability AS probability,pr.risk_level AS "riskLevel",m.model_version AS "modelVersion"
      FROM policy_recommendations r JOIN retention_policies p ON p.id=r.policy_id
      JOIN prediction_results pr ON pr.id=r.prediction_result_id JOIN employees e ON e.id=pr.employee_id
      JOIN model_run m ON m.id=pr.prediction_run_id ${where} ORDER BY r.id DESC`,values);
    return rows.map(row=>({id:row.id,predictionResultId:row.predictionResultId,policyId:row.policyId,
      employee:{id:row.employeeId,employeeCode:row.employeeCode,fullName:row.fullName},
      policy:{id:row.policyId,code:row.code,name:row.name,description:row.description,targetFactor:row.targetFactor,status:row.policyStatus},
      reason:row.reason,priority:row.priority,status:row.status,createdAt:row.createdAt,
      attritionProbability:Number(row.probability),riskLevel:row.riskLevel,modelVersion:row.modelVersion,dataSource:source(row.modelVersion)}));
  }
  async recommendations(actorId,id) {
    await this.assertHr(this.pool,actorId);
    const data=await this.readRecommendations(this.pool,id?'WHERE r.id=$1':'',id?[id]:[]);
    if(id&&!data[0]) throw new AppError(404,'Không tìm thấy đề xuất chính sách.');
    return {data:id?data[0]:data};
  }
  async readPrediction(client,id) {
    const {rows}=await client.query(`SELECT p.id,p.prediction_run_id AS "predictionRunId",p.snapshot_id AS "snapshotId",
      p.attrition_probability AS "attritionProbability",p.risk_level AS "riskLevel",p.prediction_label AS "predictionLabel",p.created_at AS "createdAt",
      e.id AS "employeeId",e.employee_code AS "employeeCode",e.full_name AS "fullName",m.model_version AS "modelVersion",
      to_jsonb(i)-'employee_id' AS input
      FROM prediction_results p JOIN employees e ON e.id=p.employee_id JOIN model_run m ON m.id=p.prediction_run_id
      JOIN ai_input i ON i.id=p.snapshot_id AND i.employee_id=p.employee_id WHERE p.id=$1`,[id]);
    if(!rows[0]) throw new AppError(404,'Không tìm thấy kết quả dự đoán.');
    const row=rows[0];
    const {rows:explanations}=await client.query(`SELECT id,feature_name AS "featureName",feature_value AS "featureValue",
      impact_value AS "impactValue",impact_direction AS "impactDirection",rank_order AS "rankOrder"
      FROM explainable WHERE prediction_result_id=$1 ORDER BY rank_order,id`,[id]);
    return {id:row.id,predictionRunId:row.predictionRunId,snapshotId:row.snapshotId,
      employee:{id:row.employeeId,employeeCode:row.employeeCode,fullName:row.fullName},
      dataSource:source(row.modelVersion),modelVersion:row.modelVersion,
      ...(row.modelVersion===DEMO_VERSION?{modelInvoked:false,explanationScale:'DEMO_ILLUSTRATIVE_NOT_SHAP'}:{}),
      attritionProbability:Number(row.attritionProbability),riskLevel:row.riskLevel,predictionLabel:row.predictionLabel,
      createdAt:row.createdAt,input:row.input,
      explanations:explanations.map(item=>({...item,impactValue:item.impactValue==null?null:Number(item.impactValue)})),
      recommendations:await this.readRecommendations(client,'WHERE r.prediction_result_id=$1',[id])};
  }
  async prediction(actorId,id) {
    await this.assertHr(this.pool,actorId);
    return {data:await this.readPrediction(this.pool,id)};
  }
}
module.exports = { PolicyDemoRepository };
