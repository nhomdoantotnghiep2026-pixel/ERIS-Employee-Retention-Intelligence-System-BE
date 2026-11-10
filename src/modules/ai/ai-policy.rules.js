const {AppError}=require('../../common/errors/app-error');
const {MODEL_ID,SCHEMA,STATUS}=require('./ai.client');
const VERSION='SHAP_ACTIONABLE_REVIEW_V1';
const DRAFTS=[
 {code:'RETENTION_SATISFACTION_CHECKIN',name:'Trao đổi và cải thiện mức độ hài lòng',targetFactor:'employee_satisfaction_score',description:'HR trao đổi riêng với nhân viên để xác nhận vấn đề về công việc hoặc môi trường, thống nhất việc cải thiện và thời điểm theo dõi lại.'},
 {code:'RETENTION_WORKLOAD_REVIEW',name:'Rà soát khối lượng và phân bổ công việc',targetFactor:'overtime_hours',description:'HR cùng nhân viên và quản lý rà soát giờ làm, thời gian tăng ca và phân bổ công việc; cân nhắc điều chỉnh lịch hoặc nguồn lực sau khi xác nhận nhu cầu.'},
 {code:'RETENTION_COMPENSATION_REVIEW',name:'Rà soát thu nhập và phúc lợi',targetFactor:'monthly_salary',description:'HR rà soát thu nhập theo chức danh, cấp bậc, mặt bằng nội bộ và phản hồi nhân viên. Không tự động tăng lương hoặc kết luận lương hiện tại thấp.'},
 {code:'RETENTION_CAREER_DEVELOPMENT',name:'Trao đổi lộ trình phát triển nghề nghiệp',targetFactor:'promotions',description:'HR trao đổi mục tiêu nghề nghiệp, tiêu chí phát triển và cơ hội đào tạo hoặc thăng tiến. Không tự động thay đổi chức danh hoặc cấp bậc.'}
];
const GROUPS=[
 {index:0,features:['Employee_Satisfaction_Score'],eligible:f=>f.Employee_Satisfaction_Score>=1&&f.Employee_Satisfaction_Score<=3},
 {index:1,features:['Overtime_Hours','Work_Hours_Per_Week'],eligible:()=>true},
 {index:2,features:['Monthly_Salary'],eligible:()=>true},
 {index:3,features:['Promotions','Years_At_Company'],eligible:f=>f.Promotions===0&&f.Years_At_Company>=1}
];
const ACTIONABLE=new Set(GROUPS.flatMap(g=>g.features));
const norm=v=>typeof v==='string'?v.toLowerCase().replace(/[^a-z0-9]/g,''):'';
function recommend(result,policies,{limit=3}={}) {
 const {model,preview}=result;
 if(!model||!preview||model.model_id!==MODEL_ID||model.schema_version!==SCHEMA||model.validation_status!==STATUS||model.demo_mode!==true)throw new AppError(409,'Chỉ hỗ trợ kết quả model Mexwell demo thật đã lưu; không dùng kết quả policy cố định.');
 const f=preview.features,c=model.contributions;
 if(!f||!c||!Number.isFinite(model.score)||!Number.isFinite(model.base_value)||Object.values(c).some(x=>typeof x!=='number'||!Number.isFinite(x))||Math.abs(model.base_value+Object.values(c).reduce((a,b)=>a+b,0)-model.score)>1e-8)throw new AppError(409,'Kết quả hoặc SHAP không hợp lệ.');
 const excluded=[];
 for(const [feature,impact] of Object.entries(c))if(impact>0&&!ACTIONABLE.has(feature))excluded.push({feature,impactValue:impact,reason:'Không dùng yếu tố này để đề xuất thay đổi nhân sự; ưu tiên yếu tố có thể hỗ trợ bằng hành động.'});
 const candidates=[];
 for(const group of GROUPS){
  const draft=DRAFTS[group.index];
  const signals=group.features.filter(key=>Number.isFinite(f[key])&&typeof c[key]==='number'&&c[key]>0&&
    (!['Overtime_Hours','Work_Hours_Per_Week','Sick_Days'].includes(key)||f[key]>0)).map(feature=>({feature,value:f[feature],impactValue:c[feature],impactPercentagePoints:Number((c[feature]*100).toFixed(6)),source:preview.provenance?.[feature]??'STORED_SNAPSHOT'}));
  if(!signals.length)continue;
  if(!group.eligible(f)){
   excluded.push(...signals.map(s=>({...s,reason:group.index===0?'Không đủ điều kiện: điểm hài lòng phải thuộc 1–3 trên thang 1–5. Điểm test ngoài thang không được tự quy đổi thành nhu cầu can thiệp.':'Chưa thỏa quy tắc lộ trình nghề nghiệp: chưa có PROMOTION và thâm niên ít nhất 1 năm.'})));continue;
  }
  const matching=policies.filter(p=>p.status==='ACTIVE'&&(p.code===draft.code||[...group.features,draft.targetFactor].some(key=>norm(key)===norm(p.targetFactor))));
  matching.sort((a,b)=>(a.code===draft.code?-1:0)-(b.code===draft.code?-1:0)||a.id-b.id);
  const policy=matching[0]??null;
  const strength=signals.reduce((sum,s)=>sum+s.impactValue,0);
  candidates.push({policy,policyDraft:policy?null:draft,signals,positiveImpact:strength,priority:'MEDIUM',
   reason:signals.map(s=>`${s.feature}=${s.value} đóng góp +${s.impactPercentagePoints} điểm phần trăm`).join('; ')+`. Đề xuất HR xem xét: ${policy?.name??draft.name}. SHAP chỉ giải thích điểm dự đoán, chưa chứng minh nguyên nhân hoặc hiệu quả chính sách.`});
 }
 candidates.sort((a,b)=>b.positiveImpact-a.positiveImpact||(a.policy?.code??a.policyDraft.code).localeCompare(b.policy?.code??b.policyDraft.code));
 return {ruleVersion:VERSION,modelId:model.model_id,snapshotId:preview.snapshotId,employee:preview.employee,
  predictionId:result.predictionId,score:model.score,demoOnly:true,autoApplied:false,
  recommendations:candidates.slice(0,limit).map((r,i)=>({...r,rank:i+1,status:r.policy?'SUGGESTED':'AWAITING_POLICY_APPROVAL'})),
  omittedCount:Math.max(0,candidates.length-limit),excludedFactors:excluded,
  warning:'Đề xuất bằng quy tắc backend từ kết quả model demo chưa đạt đánh giá, không phải policy do model sinh. HR xác nhận trước khi áp dụng. Không tự thay đổi lương, chức danh hoặc lịch làm.'};
}
module.exports={recommend,DRAFTS,VERSION};
