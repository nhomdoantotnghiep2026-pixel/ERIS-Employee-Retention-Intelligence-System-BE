const {aiInputPaths}=require('../ai_input/ai-input.swagger');
const params=[{in:'path',name:'employeeId',required:true,schema:{type:'integer',minimum:1}}];
const op=(summary,description,extra={})=>({tags:['AI Demo'],summary,description,security:[{bearerAuth:[]}],responses:{200:{description:'Thành công.'},400:{description:'Đầu vào sai.'},401:{description:'Chưa đăng nhập.'},403:{description:'Không phải HR ACTIVE.'},404:{description:'Không tìm thấy hồ sơ ACTIVE/kết quả.'},422:{description:'Thiếu dữ liệu, trả details.missingFeatures và preview.'},502:{description:'Lỗi kết nối hoặc hợp đồng model.'},503:{description:'Chưa cấu hình key hoặc model chưa sẵn sàng.'},504:{description:'AI quá thời gian chờ.'}},...extra});
const content=schema=>({required:false,content:{'application/json':{schema}}});
const predictSchema={type:'object',additionalProperties:false,required:['snapshotId'],properties:{snapshotId:{type:'integer',minimum:1,example:3,description:'ID đã lưu trong ai_input, phải thuộc đúng employeeId.'},save:{type:'boolean',default:false,description:'true: lưu kết quả, 12 giá trị SHAP và audit trong cùng transaction, dùng lại snapshot đã chọn.'}}};
const aiPaths={
 ...aiInputPaths({op,params,content}),
 '/api/ai/employees/{employeeId}/results':{get:op(
   'Danh sách kết quả AI đã lưu của nhân viên (HR)',
   'Các kết quả có thể mở qua GET /api/ai/results/{id}, mới nhất trước. Trả mảng rỗng khi không có kết quả.',
   {parameters:params,responses:{
     200:{description:'Danh sách kết quả.',content:{'application/json':{schema:{
       type:'object',properties:{data:{type:'array',items:{type:'object',properties:{
         predictionId:{type:'integer',minimum:1},
         snapshotId:{type:'integer',minimum:1},
         createdAt:{type:'string',format:'date-time'}
       }}}}
     }}}},
     400:{description:'ID nhân viên không hợp lệ.'},
     401:{description:'Chưa đăng nhập.'},
     403:{description:'Yêu cầu quyền HR đang hoạt động.'}
   }}
 )},
 '/api/ai/results/{id}/policy-recommendations':{post:op('Đề xuất chính sách giữ chân (HR)','GPT-5 mini xếp hạng tối đa 3 policy ACTIVE từ kết quả dự đoán đã lưu. save=false trả previewToken khi có đề xuất. save=true lưu đúng bản xem trước với previewToken trong 15 phút, ở trạng thái SUGGESTED.',{parameters:[{in:'path',name:'id',required:true,schema:{type:'integer',minimum:1}}],requestBody:content({type:'object',additionalProperties:false,properties:{save:{type:'boolean',default:false},limit:{type:'integer',minimum:1,maximum:3,default:3},previewToken:{type:'string'}}})})},
 '/api/ai/model':{get:op('Kiểm tra model đang chạy (HR)','Chỉ chấp nhận model mexwell-rf12-demo-v1-20e0a090ced2. Trả schema và cảnh báo chất lượng; không chạy dự đoán.')},
 '/api/ai/employees/{employeeId}/predict':{post:op('Chạy model thật và TreeSHAP (HR)','Đọc đúng snapshotId từ ai_input thuộc nhân viên, chuyển NUMERIC sang JSON number, không tổng hợp lại và không tạo snapshot mới. save=true lưu kết quả/SHAP/audit dùng lại snapshot. Snapshot test có điểm hài lòng 0–<1 được giữ nguyên để demo và ghi rõ outOfDomainFeatures; không đổi thang khảo sát nghiệp vụ.',{parameters:params,requestBody:content(predictSchema)})},
 '/api/ai/predict-batch':{post:op('Chạy nhiều nhân viên qua backend (HR)','1–25 nhân viên khác ID; tối đa 2 yêu cầu AI đồng thời. Backend gọi /v1/explain cho từng người vì batch Python chưa bật. Trả thành công/lỗi riêng từng người; có thể lưu từng người với save=true, không atomic cho toàn đợt.',{requestBody:content({type:'object',required:['employees'],additionalProperties:false,properties:{employees:{type:'array',minItems:1,maxItems:25,items:{...predictSchema,required:['employeeId','snapshotId'],properties:{employeeId:{type:'integer',minimum:1},...predictSchema.properties}}}}})})},
 '/api/ai/results/{id}':{get:op('Xem lại kết quả AI đã lưu (HR)','Trả snapshot, nguồn dữ liệu, score, SHAP và cảnh báo từ audit đi kèm. Không đọc kết quả policy cố định.',{parameters:[{in:'path',name:'id',required:true,schema:{type:'integer',minimum:1}}]})}
};
module.exports={aiPaths};
