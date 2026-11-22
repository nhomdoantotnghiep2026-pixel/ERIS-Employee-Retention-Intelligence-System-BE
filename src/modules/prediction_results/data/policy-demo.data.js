const DEMO_VERSION = 'DEMO_FIXED_POLICY_V1';
const DEMO_POLICIES = [
  {code:'DEMO_REVIEW_WORKLOAD',name:'Rà soát khối lượng công việc',targetFactor:'overtime_hours',
    description:'HR trao đổi với nhân viên và quản lý để xem xét phân bổ công việc, lịch làm và nhu cầu hỗ trợ.',
    reason:'Dữ liệu mẫu đặt tăng ca là yếu tố tăng điểm nguy cơ; đề xuất HR trao đổi để kiểm tra khối lượng công việc.',priority:'HIGH'},
  {code:'DEMO_SATISFACTION_CHECKIN',name:'Trao đổi về mức độ hài lòng',targetFactor:'employee_satisfaction_score',
    description:'HR trao đổi riêng với nhân viên, ghi nhận vấn đề và thống nhất các việc cần cải thiện.',
    reason:'Dữ liệu mẫu đặt điểm hài lòng là yếu tố tăng điểm nguy cơ; đề xuất một buổi trao đổi để tìm hiểu thêm.',priority:'HIGH'}
];
const DEMO_EXPLANATIONS = [
  {featureName:'overtime_hours',featureValue:'24',impactValue:0.14,impactDirection:'INCREASE',rankOrder:1},
  {featureName:'employee_satisfaction_score',featureValue:'2.0',impactValue:0.09,impactDirection:'INCREASE',rankOrder:2}
];
module.exports = { DEMO_VERSION, DEMO_POLICIES, DEMO_EXPLANATIONS };
