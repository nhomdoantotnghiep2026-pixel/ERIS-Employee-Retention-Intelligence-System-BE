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
const attendancePaths = {
  [base + '/config']: { get: operation('Cấu hình chấm công', 'Tọa độ công ty dùng chung với distance. Bán kính 100 m; GPS sai số tối đa 100 m. Giờ làm bắt đầu 08:00, nghỉ trưa 12:00–13:00, tăng ca sau 17:00.') },
  [base + '/today']: { get: operation('Trạng thái chấm công hôm nay', 'Tài khoản ACTIVE có employeeId liên kết hồ sơ ACTIVE phải chấm công, bao gồm HR. Chỉ trả trạng thái của tài khoản đang đăng nhập, theo ngày Việt Nam. Thứ Hai–thứ Sáu; cuối tuần không nhắc check-in.') },
  [base + '/check-in']: { post: operation('Check-in trong bán kính 100 m', 'Mỗi tài khoản check-in một lần/ngày làm việc. Tính khoảng cách thẳng Haversine, không dùng tuyến đường Vietmap. Chỉ INSIDE với GPS hợp lệ mới được ghi DB; check-in sau 08:00 là LATE, còn lại PRESENT. OUTSIDE/LOW_ACCURACY trả 200 và persisted=false để có thể thử lại. Giờ check-in lấy từ server.', true) },
  [base + '/check-out']: { post: operation('Check-out kết thúc ngày làm việc', 'Cần check-in trước và GPS trong 100 m. Mỗi ngày chỉ check-out một lần, cùng ngày Việt Nam với check-in. Lưu check_out/updated_at theo giờ server. workingMinutes = số phút check-in đến check-out trừ phần trùng nghỉ trưa 12:00–13:00, bao gồm tăng ca. overtimeMinutes tính từ thời điểm muộn hơn giữa 17:00 và check-in đến check-out. Check-in sau 17:00 vẫn được tính tăng ca từ giờ check-in; không tính thời gian trước khi có mặt. Làm tròn xuống phút nguyên. Giữ trạng thái PRESENT/LATE từ check-in; không tự đặt ON_LEAVE/HOLIDAY/ABSENT.', true) }
};
module.exports = { attendancePaths };
