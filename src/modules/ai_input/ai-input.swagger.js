const {FEATURES,PERIOD_FEATURES,DEPARTMENTS,EDUCATIONS}=require('./ai-input.features');
const supplemental={type:'object',additionalProperties:false,properties:Object.fromEntries(FEATURES.filter(k=>!PERIOD_FEATURES.includes(k)).map(k=>[k,k==='Department'?{type:'string',enum:DEPARTMENTS}:k==='Education_Level'?{type:'string',enum:EDUCATIONS}:k==='Gender'?{type:'string',enum:['Male','Female','Other']}:k==='Hire_Date'?{type:'string',format:'date'}:{type:'number',minimum:0}]))};
const previewSchema={type:'object',additionalProperties:false,required:['periodStart'],properties:{periodStart:{type:'string',format:'date',description:'Ngày bắt đầu kỳ chấm công và khảo sát. Hệ thống xác định ngày chốt.'},vndPerUsd:{type:'number',minimum:1,maximum:1000000,description:'Tùy chọn: VND cho 1 USD do HR xác minh. Bỏ trống để backend lấy tỷ giá tham chiếu mới nhất; metadata tỷ giá lưu cùng snapshot.'},supplementalFeatures:{...supplemental,description:'Chỉ bổ sung feature còn thiếu để demo; không ghi đè dữ liệu đã lấy từ database.'}}};
previewSchema.properties.supplementalFeatures.properties.Years_At_Company={type:'integer',minimum:0,maximum:102};
function aiInputPaths({op,params,content}){
 return {
 '/api/ai/employees':{get:op('Nhân viên có thể chọn chạy thử AI (HR)','Hồ sơ và tài khoản đều ACTIVE. Không có nghĩa đã đủ 12 feature.')},
 '/api/ai/employees/{employeeId}/snapshots':{get:op('Danh sách snapshot đã lưu của nhân viên (HR)','Trả các snapshot trong ai_input, feature, missingFeatures/invalidFeatures/outOfDomainFeatures; chỉ đọc.',{parameters:params})},
 '/api/ai/employees/{employeeId}/snapshots/{snapshotId}':{get:op('Xem một snapshot đã lưu (HR)','Không tạo hoặc sửa dữ liệu. Snapshot phải thuộc đúng employeeId.',{parameters:[...params,{in:'path',name:'snapshotId',required:true,schema:{type:'integer',minimum:1}}]})},
 '/api/ai/employees/{employeeId}/preview':{post:op('Kiểm tra và tạo snapshot khi đủ 12 feature (HR)','Tính giờ thực tế và điểm khảo sát trong kỳ bắt đầu từ periodStart tới lúc chốt. Tăng ca lấy từ đầu năm. Thiếu dữ liệu trả missingFeatures và issues. Đủ dữ liệu lưu snapshot và audit, trả snapshotId.',{parameters:params,requestBody:content(previewSchema)})},
 '/api/ai/exchange-rate':{get:op('Lấy tỷ giá tham chiếu USD/VND mới nhất (HR)','Nguồn Frankfurter; tỷ giá tham chiếu theo ngày, không phải giá giao dịch từng giây. Cache tối đa 60 giây. Trả rate/vndPerUsd (VND cho 1 USD), rateDate, fetchedAt, source, cached. Lỗi nguồn hoặc dữ liệu cũ hơn 7 ngày trả 503; không dùng tỷ giá mặc định. Preview tự lấy khi bỏ trống vndPerUsd và không bổ sung Monthly_Salary. Tỷ giá và metadata được cố định cùng snapshot.')}
 };
}
module.exports={aiInputPaths};
