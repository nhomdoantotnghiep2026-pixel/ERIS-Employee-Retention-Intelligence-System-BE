# Chấm công theo lịch làm việc

Attendance dùng lịch riêng của employee có effective_from <= workDate <= effective_to (null là không hết hạn). Nếu không có lịch riêng thì lấy lịch mặc định ACTIVE. Không có lịch hợp lệ: trả 409, code SCHEDULE_NOT_CONFIGURED, HR cần cấu hình lịch trước. Không tạo thêm bảng/cột.

Giờ theo Asia/Ho_Chi_Minh. Ngày làm lấy từ working_days (1=thứ Hai, 7=Chủ Nhật). Lịch hiện chưa hỗ trợ ca qua đêm.

- Check-in <= start_time: PRESENT; sau start_time: LATE.
- Check-out < end_time: EARLY_LEAVE; đi muộn và về sớm: LATE_EARLY_LEAVE.
- workingMinutes = thời gian có mặt trừ phần giao với break_start/break_end; giữ hợp đồng cũ là bao gồm tăng ca.
- overtimeMinutes = phần có mặt sau max(check-in, end_time), trừ phần giao nghỉ; không tính tăng ca trước khi nhân viên đến. Không cộng hai trường để tính tổng.
- ON_LEAVE: giờ quy ước theo start_time/end_time của ngày đó, workingMinutes/overtimeMinutes vẫn bằng 0. Chỉ sinh vào đúng ngày làm theo lịch.
- ABSENT: chỉ sinh cho ngày làm theo lịch, không còn mặc định thứ Hai–thứ Sáu.
- HOLIDAY tiếp tục chặn chấm công theo cấu hình ngày lễ.

GET /api/v1/attendance/config và /today trả thêm schedule: id, name, assignmentId, source (ASSIGNMENT/DEFAULT), startTime, endTime, breakStart, breakEnd, workingDays. Các field giờ của /config cũng thay theo người đăng nhập. Demo /attendance-demo hiển thị lịch này.

Ví dụ lịch 08:30–17:30, nghỉ 12:30–13:30: check-in 08:30, check-out 17:30 là PRESENT, 480 phút làm, 0 phút tăng ca. Check-out 18:00 là 510 phút làm, 30 phút tăng ca. Chỉ ở trong khoảng nghỉ trưa: 0 phút làm.

Kiểm tra: npm.cmd run test:attendance-schedule; npm.cmd run test:leave-requests. Test database chỉ dùng bảng TEMP, không ghi dữ liệu nghiệp vụ VPS. Không tự tính lại các bản ghi chấm công đã có.

See ../work-schedules/DEFAULT-FLOW.md for scheduled default activation and per-employee assignment history.
