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
