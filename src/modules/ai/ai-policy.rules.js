const {AppError}=require('../../common/errors/app-error');
const {MODEL_ID,SCHEMA,STATUS}=require('./ai.client');
const {FEATURES,valid}=require('./ai.features');
const VERSION='SHAP_FEATURE_REVIEW_V2';
const POLICY_DEFINITIONS=[
  {
    "code": "RETENTION_DEPARTMENT_ENVIRONMENT_V2",
    "name": "Rà soát môi trường phòng ban",
    "targetFactor": "department",
    "action": "HR trao đổi với nhân viên về khối lượng việc, cách quản lý và phối hợp; chọn một vấn đề để cải thiện trong 30 ngày.",
    "reason": "Phòng ban hiện tại đang góp phần tăng điểm cảnh báo. Cần tìm vấn đề thực tế trước khi lựa chọn hỗ trợ."
  },
  {
    "code": "RETENTION_SATISFACTION_CHECKIN_V2",
    "name": "Trao đổi về mức hài lòng",
    "targetFactor": "employee_satisfaction_score",
    "action": "Nếu điểm hài lòng thấp, tổ chức buổi trao đổi riêng, ghi nhận vấn đề ưu tiên và kiểm tra lại sau 30 ngày.",
    "reason": "Điểm hài lòng thấp có thể là đầu mối để trao đổi; chưa đủ để kết luận nhân viên muốn nghỉ."
  },
  {
    "code": "RETENTION_FAIRNESS_REVIEW_V2",
    "name": "Rà soát tính công bằng",
    "targetFactor": "gender",
    "action": "HR kiểm tra phản ánh về cơ hội phát triển, đãi ngộ và môi trường làm việc; hỗ trợ theo vấn đề được xác nhận.",
    "reason": "Dữ liệu chưa cho thấy khác biệt đáng kể theo giới tính. Không dùng giới tính để quyết định ai được giữ chân hoặc nhận quyền lợi."
  },
  {
    "code": "RETENTION_CAREER_NEEDS_V2",
    "name": "Trao đổi về nhu cầu nghề nghiệp",
    "targetFactor": "age",
    "action": "Hỏi mục tiêu và khó khăn hiện tại, sau đó thống nhất hỗ trợ phù hợp như đào tạo, mentor hoặc điều chỉnh vai trò.",
    "reason": "Tuổi không đủ để giải thích ý định nghỉ việc. Nhu cầu thực tế của nhân viên mới là căn cứ chọn hỗ trợ."
  },
  {
    "code": "RETENTION_ONBOARDING_REVIEW_V2",
    "name": "Kiểm tra trải nghiệm gia nhập",
    "targetFactor": "hire_date",
    "action": "Nếu nhân viên mới vào, rà soát onboarding và bổ sung người hướng dẫn; nếu đã làm lâu, kiểm tra bối cảnh đợt tuyển.",
    "reason": "Ngày tuyển dụng là đầu mối kiểm tra trải nghiệm gia nhập, chưa chứng minh người tuyển sau dễ nghỉ hơn."
  },
  {
    "code": "RETENTION_OVERTIME_REVIEW_V2",
    "name": "Rà soát tăng ca",
    "targetFactor": "overtime_hours",
    "action": "Nếu giờ tăng ca thực tế cao, quản lý phân bổ lại nhiệm vụ và theo dõi mức tăng ca trong 4 tuần tiếp theo.",
    "reason": "Cần kiểm tra tình trạng quá tải vì đây là vấn đề có thể can thiệp, dù dữ liệu chưa chứng minh tăng ca gây nghỉ việc."
  },
  {
    "code": "RETENTION_WORK_SCHEDULE_REVIEW_V2",
    "name": "Rà soát lịch làm",
    "targetFactor": "work_hours_per_week",
    "action": "Đối chiếu giờ làm thực tế với lịch đã thống nhất, giảm việc ít ưu tiên và bảo đảm thời gian nghỉ.",
    "reason": "Điểm cảnh báo là lý do để kiểm tra khối lượng việc, không đủ để kết luận nhân viên làm quá sức."
  },
  {
    "code": "RETENTION_SKILL_JOB_FIT_V2",
    "name": "Rà soát mức phù hợp công việc",
    "targetFactor": "education_level",
    "action": "Trao đổi về kỹ năng đang sử dụng và kỹ năng muốn phát triển; chọn khóa học hoặc nhiệm vụ phù hợp.",
    "reason": "Bằng cấp không cho biết rõ nguy cơ nghỉ việc. Cần xác minh nhân viên có đang thiếu cơ hội sử dụng và phát triển năng lực hay không."
  },
  {
    "code": "RETENTION_TENURE_SUPPORT_V2",
    "name": "Hỗ trợ theo giai đoạn làm việc",
    "targetFactor": "years_at_company",
    "action": "Người mới được kiểm tra khả năng hòa nhập; người lâu năm được trao đổi về cơ hội phát triển hoặc luân chuyển.",
    "reason": "Thâm niên giúp chọn nội dung trao đổi, nhưng chưa đủ để xác định nhóm nào cần giữ chân hơn."
  },
  {
    "code": "RETENTION_PROMOTION_EXPECTATIONS_V2",
    "name": "Làm rõ kỳ vọng phát triển",
    "targetFactor": "promotions",
    "action": "Rà soát mục tiêu thăng tiến; nếu vừa được thăng chức, kiểm tra trách nhiệm mới và hỗ trợ chuyển vai trò.",
    "reason": "Không thể kết luận ít thăng chức làm tăng nghỉ việc từ bảng này. Cần kiểm tra cả kỳ vọng thăng tiến và áp lực sau thăng chức."
  },
  {
    "code": "RETENTION_SALARY_REVIEW_V2",
    "name": "Rà soát mức lương",
    "targetFactor": "monthly_salary",
    "action": "Đối chiếu với cùng vai trò, cấp bậc và trách nhiệm; đề xuất điều chỉnh nếu xác nhận có chênh lệch không hợp lý.",
    "reason": "Không tự động đề xuất tăng lương từ điểm cảnh báo. Chỉ điều chỉnh khi có căn cứ về đãi ngộ."
  },
  {
    "code": "RETENTION_VOLUNTARY_SUPPORT_V2",
    "name": "Hỏi về nhu cầu hỗ trợ",
    "targetFactor": "sick_days",
    "action": "Trao đổi riêng, tự nguyện về lịch làm và khối lượng việc; bố trí linh hoạt nếu nhân viên cần.",
    "reason": "Số ngày nghỉ ốm không cho biết ý định nghỉ việc. Mục tiêu là hỗ trợ, không gây áp lực giảm nghỉ ốm."
  }
];
// description chỉ lưu nội dung chính sách. Điều kiện kích hoạt được tạo theo
// từng kết quả dự đoán và chỉ lưu trong policy_recommendations.reason.
const DRAFTS=POLICY_DEFINITIONS.map(policy=>({...policy,description:policy.action}));
const norm=value=>typeof value==='string'?value.toLowerCase().replace(/[^a-z0-9]/g,''):'';
const rules=DRAFTS.map(draft=>({draft,feature:FEATURES.find(key=>norm(key)===norm(draft.targetFactor))}));
function recommend(result,policies,{limit=3}={}){
 if(!Number.isInteger(limit)||limit<1||limit>12)throw new AppError(400,'limit phải là số nguyên 1–12.');
 const {model,preview}=result;
 if(!model||!preview||model.model_id!==MODEL_ID||model.schema_version!==SCHEMA||model.validation_status!==STATUS||model.demo_mode!==true)throw new AppError(409,'Chỉ hỗ trợ kết quả model Mexwell demo thật đã lưu; không dùng kết quả policy cố định.');
 const f=preview.features,c=model.contributions;
 if(!f||!c||!Number.isFinite(model.score)||model.score<0||model.score>1||!Number.isFinite(model.base_value)
  ||FEATURES.some(key=>!Object.hasOwn(c,key))||Object.keys(c).some(key=>!FEATURES.includes(key))
  ||Object.values(c).some(value=>typeof value!=='number'||!Number.isFinite(value))
  ||Math.abs(model.base_value+Object.values(c).reduce((a,b)=>a+b,0)-model.score)>1e-8)throw new AppError(409,'Kết quả hoặc SHAP không hợp lệ.');
 const candidates=[],excluded=[];
 for(const {draft,feature} of rules){
  if(c[feature]<=0)continue;
  const value=f[feature];
  if(!valid(feature,value)){
   excluded.push({feature,value,impactValue:c[feature],reason:'Giá trị feature thiếu hoặc ngoài miền hợp lệ. Giữ nguyên snapshot và không suy ra nhu cầu hỗ trợ từ giá trị này.'});
   continue;
  }
  const signal={feature,value,impactValue:c[feature],impactPercentagePoints:Number((c[feature]*100).toFixed(6)),source:preview.provenance?.[feature]??'STORED_SNAPSHOT'};
  const matches=policies.filter(policy=>policy.status==='ACTIVE'&&(policy.code===draft.code||norm(policy.targetFactor)===norm(draft.targetFactor)));
  matches.sort((a,b)=>Number(b.code===draft.code)-Number(a.code===draft.code)||Number(a.id)-Number(b.id));
  const policy=matches[0]??null;
  const sourceNote=feature==='Sick_Days'?' Dữ liệu backend hiện đếm ON_LEAVE + ABSENT, chưa phân biệt nghỉ ốm; phải xác minh loại nghỉ trước khi trao đổi.':'';
  candidates.push({policy,policyDraft:policy?null:draft,signals:[signal],positiveImpact:signal.impactValue,priority:'MEDIUM',
   reason:`Điều kiện xem xét: ${feature}=${value} có đóng góp SHAP dương +${signal.impactPercentagePoints} điểm phần trăm so với mức tham chiếu; đề xuất HR xem xét ${policy?.name??draft.name}. ${draft.reason}${sourceNote} SHAP không chứng minh quan hệ nhân quả hoặc hiệu quả chính sách.`,
   requiresHrConfirmation:true});
 }
 candidates.sort((a,b)=>b.positiveImpact-a.positiveImpact||(a.policy?.code??a.policyDraft.code).localeCompare(b.policy?.code??b.policyDraft.code));
 return {ruleVersion:VERSION,modelId:model.model_id,snapshotId:preview.snapshotId,employee:preview.employee,predictionId:result.predictionId,
  score:model.score,demoOnly:true,autoApplied:false,
  recommendations:candidates.slice(0,limit).map((row,index)=>({...row,rank:index+1,status:row.policy?'SUGGESTED':'AWAITING_POLICY_APPROVAL'})),
  omittedCount:Math.max(0,candidates.length-limit),excludedFactors:excluded,
  warning:'Đề xuất bằng quy tắc backend từ SHAP dương của 12 feature, không phải chính sách do model tự sinh. Mức ưu tiên MEDIUM là mặc định, không phải mức rủi ro. HR xác minh nhu cầu trước khi áp dụng; không tự đổi quyền lợi, lương, chức danh hoặc lịch làm. Tuổi/giới tính không là căn cứ phân biệt đối xử. Model demo chưa đạt tiêu chí đánh giá.'};
}
module.exports={recommend,DRAFTS,VERSION};
