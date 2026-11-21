const {AppError}=require('../../common/errors/app-error');
const {recommend,VERSION}=require('./ai-policy.rules');
const {id}=require('../ai_input/ai-input.features');
class AiPolicyRepository {
 constructor(pool,aiRepository,engine){Object.assign(this,{pool,aiRepository,engine});}
 async policies(client=this.pool,lock=false){return (await client.query(`SELECT id,code,name,description,to_jsonb(p)->>'target_factor' AS "targetFactor",status FROM retention_policies p WHERE status='ACTIVE' ORDER BY id ${lock?'FOR SHARE':''}`)).rows;}
 async context(actorId,predictionId,client=this.pool){
  await this.aiRepository.assertHr(actorId,client);
  const result=await this.aiRepository.result(actorId,predictionId);
  const {rows}=await client.query(`SELECT p.id FROM prediction_results p
    JOIN employees e ON e.id=p.employee_id WHERE p.id=$1 AND e.employment_status='ACTIVE'`,[predictionId]);
  if(!rows.length)throw new AppError(409,'Nhân viên không còn ACTIVE.');
  return result;
 }
 async generate(actorId,predictionId,body={}){
  predictionId=id(predictionId);
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!['save','limit','previewToken'].includes(k))||body.save!==undefined&&typeof body.save!=='boolean'||body.limit!==undefined&&(!Number.isInteger(body.limit)||body.limit<1||body.limit>(this.engine?3:12))||body.previewToken!==undefined&&(body.save!==true||typeof body.previewToken!=='string'))throw new AppError(400,'Thông số đề xuất chính sách không hợp lệ.');
  const result=await this.context(actorId,predictionId);
  if(body.save!==true){
   const policies=await this.policies();
   if(!this.engine)return {...recommend(result,policies,body),saved:false,catalogModified:false};
   const choices=await this.engine.select(result,policies,body.limit??3);
   await this.aiRepository.assertHr(actorId);
   const currentPolicies=choices.length?await this.policies():policies;
   return {...this.engine.format(result,currentPolicies,choices),saved:false,catalogModified:false,
    previewToken:choices.length?this.engine.token(actorId,predictionId,choices):null};
  }
  const choices=this.engine?.verify(body.previewToken,actorId,predictionId);
  const client=await this.pool.connect();
  try{
   await client.query('BEGIN');
   await client.query('SELECT pg_advisory_xact_lock($1,$2)',[74129,predictionId]);
   await this.aiRepository.assertHr(actorId,client,true);
   // Lock result, employee and catalogue before persisting. No AI/network call inside transaction.
   const locked=await client.query(`SELECT p.id FROM prediction_results p JOIN employees e ON e.id=p.employee_id
     WHERE p.id=$1 AND e.employment_status='ACTIVE' FOR SHARE OF p,e`,[predictionId]);
   if(!locked.rows.length)throw new AppError(409,'Nhân viên không còn ACTIVE; không lưu đề xuất.');
   const policies=await this.policies(client,true);
   const generated=this.engine?this.engine.format(result,policies,choices):recommend(result,policies,body);
   const saved=[];
   for(const candidate of generated.recommendations.filter(r=>r.policy)){
    const existing=(await client.query(`SELECT id,status FROM policy_recommendations WHERE prediction_result_id=$1 AND policy_id=$2 ORDER BY id LIMIT 1 FOR UPDATE`,[predictionId,candidate.policy.id])).rows[0];
    if(existing){saved.push({id:existing.id,policyId:candidate.policy.id,status:existing.status,created:false});continue;}
    const inserted=(await client.query(`INSERT INTO policy_recommendations(prediction_result_id,policy_id,reason,priority,status) VALUES($1,$2,$3,$4,'SUGGESTED') RETURNING id,status`,[predictionId,candidate.policy.id,candidate.reason,candidate.priority])).rows[0];
    await client.query(`INSERT INTO audit_logs(user_id,entity_type,entity_id,action,new_value) VALUES($1,'policy_recommendations',$2,'CREATE',$3::jsonb)`,[actorId,inserted.id,JSON.stringify({predictionId,policyId:candidate.policy.id,ruleVersion:generated.ruleVersion??VERSION,recommendationModel:generated.recommendationModel,reason:candidate.reason,signals:candidate.signals,hrReviewChecks:candidate.hrReviewChecks,demoOnly:true,status:'SUGGESTED'})]);
    saved.push({id:inserted.id,policyId:candidate.policy.id,status:inserted.status,created:true});
   }
   await client.query('COMMIT');
   return {...generated,saved:true,savedRecommendations:saved,catalogModified:false,requiresPolicyApproval:generated.recommendations.some(r=>!r.policy)};
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
 }
}
module.exports={AiPolicyRepository};
