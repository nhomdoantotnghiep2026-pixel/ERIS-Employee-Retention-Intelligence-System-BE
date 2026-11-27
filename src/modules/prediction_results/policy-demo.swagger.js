const security=[{bearerAuth:[]}];
const responses={200:{description:'Thành công; data là danh sách hoặc bản ghi.'},400:{description:'ID hoặc body không hợp lệ.'},401:{description:'Thiếu/sai access token.'},403:{description:'Chỉ HR ACTIVE được sử dụng.'},404:{description:'Không tìm thấy bản ghi.'}};
const parameter=(int32=false)=>[{name:'id',in:'path',required:true,schema:int32?{type:'integer',minimum:1,maximum:2147483647}:{type:'string',pattern:'^[1-9][0-9]*$',example:'1'},description:'ID của bản ghi trong database.'}];
const read=(summary,description,parameters)=>({tags:['Policy demo'],summary,description,security,responses,...(parameters?{parameters}:{})});
const policyDemoPaths={
  '/api/prediction-results/demo':{post:{tags:['Policy demo'],summary:'Tạo kết quả và policy demo cố định (không chạy model)',security,
    description:'HR ACTIVE chọn 1–100 nhân viên có tài khoản/hồ sơ ACTIVE. Ghi phiên bản DEMO_FIXED_POLICY_V1 vào audit của từng kết quả. Mỗi nhân viên có ai_input với 2 feature mẫu, prediction_results xác suất 0.78/HIGH/true, 2 explainable và 2 policy_recommendations SUGGESTED. Tự tạo 2 retention_policies mã DEMO_ nếu chưa có. Mọi nhân viên nhận cùng dữ liệu minh họa, không lấy feature thực tế để dự đoán. Các impact giả lập chưa phải SHAP. Mỗi lần gọi tạo một lần demo mới; danh mục policy được dùng lại. Toàn bộ ghi trong cùng transaction, một nhân viên không hợp lệ sẽ hủy cả lần ghi.',
    requestBody:{required:true,content:{'application/json':{schema:{type:'object',additionalProperties:false,required:['employeeIds'],properties:{employeeIds:{type:'array',minItems:1,maxItems:100,uniqueItems:true,items:{type:'integer',minimum:1,maximum:2147483647},example:[1,2]}}}}}},
    responses:{...responses,201:{description:'dataSource DEMO_FIXED, modelInvoked false, explanationScale DEMO_ILLUSTRATIVE_NOT_SHAP, run, policies và results. Mỗi result có employee, input, xác suất, explanations và recommendations kèm policy.'},409:{description:'Nhân viên không ACTIVE/không tồn tại hoặc policy demo đã INACTIVE.'}}
  }},
  '/api/prediction-results/{id}':{get:read('HR xem kết quả demo và các yếu tố giải thích','Trả kết quả đã lưu, nhân viên, input, các yếu tố và đề xuất chính sách. Với dữ liệu demo, response có dataSource DEMO_FIXED và modelInvoked false. Không chạy model khi đọc.',parameter(true))},
  '/api/retention-policies':{get:read('HR xem danh mục chính sách giữ chân','Trả tất cả chính sách gồm id, code, name, description, status, createdAt, updatedAt. Chưa tạo demo/dữ liệu thì trả mảng rỗng. ID bigint trả dạng chuỗi để giữ chính xác.')},
  '/api/retention-policies/{id}':{get:read('HR xem chi tiết chính sách','Trả một chính sách trong danh mục.',parameter())},
  '/api/policy-recommendations':{get:read('HR xem danh sách đề xuất chính sách','Trả các đề xuất đã lưu cùng nhân viên, policy, reason, priority, status, xác suất, mức rủi ro và nhãn dữ liệu demo. ID bigint trả dạng chuỗi.')},
  '/api/policy-recommendations/{id}':{get:read('HR xem chi tiết đề xuất chính sách','Trả đề xuất gắn với một predictionResultId và policyId, kèm dữ liệu hiển thị cho FE.',parameter())}
};
const {POLICY_LIMITS}=require('./helpers/policy-create.validation');
policyDemoPaths['/api/retention-policies'].post={
 tags:['Retention policies'],summary:'HR tạo policy giữ chân nhân viên',security,
 description:'Chỉ HR ACTIVE. Mã được trim và chuyển thành chữ hoa, không trùng kể cả mã của policy INACTIVE. description chỉ chứa nội dung chính sách; không nhận reason, người tạo hoặc ID từ client. status mặc định ACTIVE. Tạo policy và ghi audit_logs trong cùng transaction. Không tự tạo policy_recommendations hay áp dụng chính sách cho nhân viên.',
 requestBody:{required:true,content:{'application/json':{schema:{type:'object',additionalProperties:false,required:['code','name','description'],properties:{
  code:{type:'string',minLength:1,maxLength:POLICY_LIMITS.code,pattern:'^[A-Za-z0-9][A-Za-z0-9_-]*$',example:'RETENTION_WORKLOAD_REVIEW'},
  name:{type:'string',minLength:1,maxLength:POLICY_LIMITS.name,example:'Rà soát khối lượng công việc'},
  description:{type:'string',minLength:1,maxLength:POLICY_LIMITS.description,example:'HR trao đổi với nhân viên và quản lý về phân bổ nhiệm vụ, thống nhất điều chỉnh và kiểm tra lại sau 30 ngày.'},
  status:{type:'string',enum:['ACTIVE','INACTIVE'],default:'ACTIVE'}
 }}}}},
 responses:{201:{description:'Đã tạo; trả {data:{id,code,name,description,status,createdAt,updatedAt}} và Location trỏ đến API chi tiết. id bigint dạng chuỗi.',headers:{Location:{schema:{type:'string'}}}},400:responses[400],401:responses[401],403:responses[403],409:{description:'Mã policy đã tồn tại; không tự ghi đè hoặc kích hoạt lại.'}}
};
module.exports = { policyDemoPaths };
