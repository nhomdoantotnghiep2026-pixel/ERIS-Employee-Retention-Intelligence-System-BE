const base = '/api/v1/attendance';
const location = {
  type: 'object', additionalProperties: false,
  required: ['latitude', 'longitude', 'accuracyMeters'],
  properties: {
    latitude: { type: 'number', minimum: -90, maximum: 90, description: 'Vĩ độ GPS thực tế từ thiết bị.' },
    longitude: { type: 'number', minimum: -180, maximum: 180, description: 'Kinh độ GPS thực tế từ thiết bị.' },
    accuracyMeters: { type: 'number', minimum: 0, maximum: 100000, example: 15, description: 'Sai số GPS (m). Lớn hơn 100 m trả LOW_ACCURACY, không ghi nhận check-in.' },
    capturedAt: { type: 'string', format: 'date-time', description: 'Tùy chọn: thời điểm lấy GPS; phải cách giờ server không quá 5 phút.' }
  }
};
function operation(summary, description, body = false) {
  return { tags: ['Attendance'], summary, description, security: [{ bearerAuth: [] }],
    ...(body ? { requestBody: { required: true, content: { 'application/json': { schema: location } } } } : {}),
    responses: {
      200: { description: 'Thành công. INSIDE: trong bán kính; OUTSIDE: ngoài 100 m; LOW_ACCURACY: GPS sai số quá lớn. Kiểm tra persisted để biết đã ghi DB hay chưa. Dữ liệu lưu trong bảng attendance PostgreSQL. attendance gồm checkIn, checkOut, workingMinutes, overtimeMinutes, attendanceStatus, createdAt, updatedAt.' },
      400: { description: 'Tọa độ/sai số/thời gian không hợp lệ hoặc vị trí quá cũ.' },
      401: { description: 'Thiếu token hoặc tài khoản không ACTIVE.' },
      403: { description: 'Phải có employeeId liên kết hồ sơ đang ACTIVE, không phụ thuộc role.' },
      409: { description: 'Cuối tuần, nghỉ phép/ngày lễ, đã check-in/check-out hoặc check-out khi chưa check-in.' },
      503: { description: 'Dịch vụ chưa sẵn sàng.' }
    }
  };
}
const companyLocationResponses = {
  200: { description: 'data gồm address, latitude, longitude, source (redis hoặc env), updatedAt, updatedBy. Bán kính giữ nguyên 100 m.' },
  400: { description: 'Địa chỉ hoặc tọa độ không hợp lệ; không nhận trường khác.' },
  401: { description: 'Thiếu token hoặc tài khoản không ACTIVE.' },
  403: { description: 'Chỉ HR ACTIVE có employeeId và hồ sơ nhân viên ACTIVE.' },
  503: { description: 'Không truy cập được cấu hình Redis.' }
};
const attendancePaths = {
  [base + '/company-location']: {
    get: { tags: ['Attendance'], summary: 'Xem vị trí công ty (HR có hồ sơ ACTIVE)', security: [{ bearerAuth: [] }], responses: companyLocationResponses },
    put: { tags: ['Attendance'], summary: 'Cập nhật địa chỉ và tọa độ công ty (HR)', security: [{ bearerAuth: [] }],
      description: 'Thay thế đủ 3 trường. Lưu Redis không TTL; check-in/check-out đọc cấu hình mới ngay. Chưa từng lưu thì dùng cấu hình môi trường. Redis lỗi trả 503. Chỉ đổi địa điểm chấm công, không đổi điểm đến của API distance. Không tự xác minh địa chỉ có khớp tọa độ; HR kiểm tra điểm ghim trước khi lưu.',
      requestBody: { required: true, content: { 'application/json': { schema: {
        type: 'object', additionalProperties: false, required: ['address', 'latitude', 'longitude'],
        properties: { address: { type: 'string', maxLength: 500, example: 'Địa chỉ công ty' },
          latitude: { type: 'number', minimum: -90, maximum: 90, example: 10.845106259160106 },
          longitude: { type: 'number', minimum: -180, maximum: 180, example: 106.83894307850271 } }
      } } } }, responses: companyLocationResponses }
  },
  [base + '/config']: { get: operation('Cấu hình chấm công', 'Tọa độ chấm công đọc từ Redis; chưa từng lưu thì dùng cấu hình môi trường. Độc lập với điểm đến của API distance. Bán kính 100 m; GPS sai số tối đa 100 m. Giờ làm bắt đầu 08:00, nghỉ trưa 12:00–13:00, tăng ca sau 17:00.') },
  [base + '/today']: { get: operation('Trạng thái chấm công hôm nay', 'Tài khoản ACTIVE có employeeId liên kết hồ sơ ACTIVE phải chấm công, bao gồm HR. Chỉ trả trạng thái của tài khoản đang đăng nhập, theo ngày Việt Nam. Thứ Hai–thứ Sáu; cuối tuần không nhắc check-in.') },
  [base + '/check-in']: { post: operation('Check-in trong bán kính 100 m', 'Mỗi tài khoản check-in một lần/ngày làm việc. Tính khoảng cách thẳng Haversine, không dùng tuyến đường Vietmap. Chỉ INSIDE với GPS hợp lệ mới được ghi DB; check-in sau 08:00 là LATE, còn lại PRESENT. OUTSIDE/LOW_ACCURACY trả 200 và persisted=false để có thể thử lại. Giờ check-in lấy từ server.', true) },
  [base + '/check-out']: { post: operation('Check-out kết thúc ngày làm việc', 'Cần check-in trước và GPS trong 100 m. Mỗi ngày chỉ check-out một lần, cùng ngày Việt Nam với check-in. Lưu check_out/updated_at theo giờ server. workingMinutes = số phút check-in đến check-out trừ phần trùng nghỉ trưa 12:00–13:00, bao gồm tăng ca. overtimeMinutes tính từ thời điểm muộn hơn giữa 17:00 và check-in đến check-out. Check-in sau 17:00 vẫn được tính tăng ca từ giờ check-in; không tính thời gian trước khi có mặt. Làm tròn xuống phút nguyên. Giữ trạng thái PRESENT/LATE từ check-in; không tự đặt ON_LEAVE/HOLIDAY/ABSENT.', true) }
};
const historyResponses={200:{description:'Danh sách: data chứa toàn bộ bản ghi. Chi tiết: data chứa một bản ghi. Mỗi bản ghi gồm id, employeeId, employeeCode, fullName, workDate, checkIn/checkOut (có thể null), workingMinutes, overtimeMinutes, attendanceStatus, createdAt, updatedAt. Thời gian +07:00. Một bản ghi tương ứng một nhân viên/ngày, không phải hai sự kiện riêng.'},400:{description:'ID bản ghi không hợp lệ.'},401:{description:'Thiếu/sai token hoặc tài khoản không ACTIVE.'},403:{description:'Chỉ HR được xem lịch sử chấm công.'}};
attendancePaths[base]={get:{tags:['Attendance'],summary:'HR xem danh sách chấm công',security:[{bearerAuth:[]}],description:'HR ACTIVE xem lịch sử nhân viên kể cả đã ngừng hoạt động, gồm hồ sơ của mình. HR phải có employeeId và hồ sơ đang ACTIVE theo điều kiện truy cập module chấm công. Trả toàn bộ bản ghi, sắp xếp ngày và id giảm dần. Không cần tham số; frontend tự lọc và phân trang. Không trả lương, mật khẩu hoặc dữ liệu dự báo.',responses:historyResponses}};
attendancePaths[base+'/{id}']={get:{tags:['Attendance'],summary:'HR xem chi tiết bản ghi chấm công',security:[{bearerAuth:[]}],parameters:[{name:'id',in:'path',required:true,schema:{type:'integer',minimum:1},description:'ID bản ghi attendance, không phải employeeId.'}],responses:{...historyResponses,404:{description:'Không tìm thấy bản ghi chấm công.'}}}};
module.exports = { attendancePaths };
const secured = [{ bearerAuth: [] }];
const dateSchema = { type:'string', format:'date', example:'2026-11-09' };
const response = { 200:{description:'Thành công.'},400:{description:'Dữ liệu không hợp lệ.'},401:{description:'Tài khoản chưa ACTIVE.'},403:{description:'Không đủ quyền hoặc HR tự duyệt đơn của mình.'},409:{description:'Trùng lịch, đã có bản ghi chấm công hoặc đã xử lý.'},503:{description:'Redis không khả dụng.'} };
const jsonBody = (required, properties) => ({ required:true,content:{'application/json':{schema:{type:'object',additionalProperties:false,required,properties}}} });
const leaveIdParameter = [{name:'id',in:'path',required:true,schema:{type:'integer',minimum:1,maximum:2147483647},description:'ID số nguyên của leave_requests; không dùng UUID Redis cũ.'}];
const leaveResponses = {...response,404:{description:'Không tìm thấy đơn nghỉ phép.'}};
const reviewBody = jsonBody(['decision'],{decision:{type:'string',enum:['APPROVED','REJECTED']},reviewNote:{type:'string',maxLength:500}});
attendancePaths[base+'/leave-requests']={
  post:{tags:['Attendance'],summary:'Gửi đơn nghỉ phép',description:'Nhân viên hoặc HR có tài khoản/hồ sơ ACTIVE gửi đơn cho chính mình. fromDate phải sau hôm nay theo giờ Việt Nam, có thể đăng ký trước nhiều ngày; tối đa 30 ngày liên tiếp. Lưu PENDING trong leave_requests và một lịch sử null → PENDING kèm lý do trong leave_request_histories; không dùng Redis. Chặn trùng đơn đang có hiệu lực, kể cả đang xin hủy hoặc đã bị từ chối hủy.',security:secured,requestBody:jsonBody(['fromDate','toDate','reason'],{fromDate:dateSchema,toDate:dateSchema,reason:{type:'string',maxLength:500}}),responses:leaveResponses},
  get:{tags:['Attendance'],summary:'HR xem tất cả đơn nghỉ phép',description:'Trả data là danh sách đơn với employeeId, employeeCode, fullName, fromDate, toDate, reason, status, effectiveStatus, histories và thông tin cancellation nếu có. effectiveStatus cho biết đơn gốc còn chờ duyệt hay đã được duyệt trong lúc xin hủy hoặc bị từ chối hủy.',security:secured,responses:leaveResponses}
};
attendancePaths[base+'/leave-requests/me']={get:{tags:['Attendance'],summary:'Xem đơn nghỉ phép của mình',security:secured,responses:leaveResponses}};
attendancePaths[base+'/leave-requests/{id}/history']={get:{tags:['Attendance'],summary:'Xem lịch sử chuyển trạng thái đơn nghỉ',description:'HR ACTIVE xem được tất cả; EMPLOYEE chỉ xem đơn của mình. Response data chứa thông tin đơn và histories theo thứ tự, gồm fromStatus, toStatus, note văn bản, reviewedBy (ID tài khoản thực hiện, kể cả nhân viên), actorName, actorRole, createdAt. Dữ liệu cũ trước khi có lịch sử có thể có histories rỗng.',security:secured,parameters:leaveIdParameter,responses:leaveResponses}};
attendancePaths[base+'/leave-requests/{id}']={patch:{tags:['Attendance'],summary:'HR duyệt hoặc từ chối đơn nghỉ phép',description:'HR khác xử lý đơn PENDING, hoặc CANCEL_REJECTED có effectiveStatus PENDING. APPROVED chỉ lưu trạng thái và lịch sử kèm ghi chú HR trong cùng transaction PostgreSQL, chưa tạo attendance. Đến từng ngày nghỉ, tác vụ mới tạo ON_LEAVE nếu đơn còn hiệu lực. Response attendance là mảng rỗng và attendanceScheduled=true khi duyệt. Không duyệt đơn đã đến ngày bắt đầu nghỉ.',security:secured,parameters:leaveIdParameter,requestBody:reviewBody,responses:leaveResponses}};
attendancePaths[base+'/leave-requests/{id}/cancellation']={
  post:{tags:['Attendance'],summary:'Gửi yêu cầu hủy đơn nghỉ phép của mình',description:'Chỉ chủ đơn có tài khoản/hồ sơ ACTIVE được xin hủy. Đơn gốc phải PENDING hoặc APPROVED và fromDate phải sau hôm nay (giờ Việt Nam). Cập nhật đơn thành CANCEL_REQUESTED, lưu from_status/to_status và lý do xin hủy vào lịch sử. Đơn gốc đã APPROVED vẫn có hiệu lực trong lúc chờ hủy. Không gửi trùng yêu cầu hủy; có thể xin lại sau CANCEL_REJECTED nếu đơn gốc còn đủ điều kiện.',security:secured,parameters:leaveIdParameter,requestBody:jsonBody(['reason'],{reason:{type:'string',minLength:1,maxLength:500}}),responses:leaveResponses},
  patch:{tags:['Attendance'],summary:'HR duyệt hoặc từ chối yêu cầu hủy',description:'HR không tự xử lý đơn của mình. decision APPROVED chuyển CANCELLED, đến hạn sẽ không tạo ON_LEAVE. decision REJECTED chuyển CANCEL_REJECTED và giữ hiệu lực đơn gốc. Mỗi thao tác thêm một lịch sử có ghi chú của HR, không lưu JSON trong note. Chấp thuận hủy chỉ khi đơn chưa đến ngày bắt đầu nghỉ. Toàn bộ thay đổi trong cùng transaction PostgreSQL.',security:secured,parameters:leaveIdParameter,requestBody:reviewBody,responses:leaveResponses}
};
attendancePaths[base+'/holidays']={
  post:{tags:['Attendance'],summary:'HR chọn ngày nghỉ lễ',description:'Lưu lịch trong Redis, tạo bản ghi HOLIDAY cho nhân viên ACTIVE và chặn check-in/check-out ngày đó. Không chấp nhận ngày đã có check-in/check-out.',security:secured,requestBody:jsonBody(['date','name'],{date:dateSchema,name:{type:'string',maxLength:150}}),responses:response},
  get:{tags:['Attendance'],summary:'HR xem lịch nghỉ lễ',security:secured,responses:response}
};
attendancePaths[base+'/close-day']={post:{tags:['Attendance'],summary:'HR chốt vắng mặt ngày đã qua',description:'Tạo ABSENT cho nhân viên ACTIVE chưa có check-in/check-out hoặc ON_LEAVE/HOLIDAY vào một ngày làm việc trong quá khứ. Gọi lại không tạo trùng.',security:secured,requestBody:jsonBody(['date'],{date:dateSchema}),responses:response}};
attendancePaths[base+'/check-out'].post.description += ' Khi checkout, trạng thái cuối cùng là PRESENT nếu đi/về đúng giờ, LATE nếu đến sau 08:00, EARLY_LEAVE nếu về trước 17:00, hoặc LATE_EARLY_LEAVE nếu cả hai.';
attendancePaths[base+'/today'].get.description += ' Ngày lễ đọc từ Redis kể cả hồ sơ chưa có dòng attendance; đơn nghỉ được duyệt có ON_LEAVE trong bảng.';
attendancePaths[base+'/holidays'].post.description = 'HR lưu ngày lễ trong Redis. Đến đúng ngày lễ, hệ thống tự ghi HOLIDAY vào attendance cho nhân viên có tài khoản và hồ sơ ACTIVE, kể cả người mới kích hoạt trước ngày lễ; ngày đó không thể check-in/check-out.';
attendancePaths[base+'/today'].get.description += ' Bản ghi ON_LEAVE đến hạn có checkIn lúc 08:00 và checkOut lúc 17:00 cùng ngày, theo giờ Việt Nam. Đây là giờ quy ước nghỉ phép; workingMinutes và overtimeMinutes bằng 0.';
