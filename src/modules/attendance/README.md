# Hồ sơ chấm công qua import

Màn hình chính `/attendance`: HR xem, import và tổng hợp hồ sơ. `/my-attendance`: nhân viên chỉ xem hồ sơ của mình. Không còn thao tác GPS check-in/check-out trên các màn hình này.

## Schema và nguồn dữ liệu

Code đang chạy chỉ ghi các cột attendance hiện có: employee_id, work_date, work_schedule_id, check_in, check_out, working_minutes, overtime_minutes, late_mins, early_mins, attendance_status, record_status, cancellation_reason, cancelled_by, created_at, updated_at. Không cần các cột version, cancelled_at, outside_shift_minutes, schedule_snapshot, calculation_version, leave_type hay thông tin batch. Không tự chạy migration.

Lịch lấy từ `employees.work_schedule_id -> work_schedules.id`. File shift_type phải khớp lịch được gán, không dùng mã trong file để chọn một lịch khác. Thiếu lịch hoặc hire_date phải sửa hồ sơ trước. Lịch hiện tại được dùng đối chiếu lịch sử; không suy đoán lịch cũ đã từng gán.

## Import giờ làm

- POST `/api/v1/attendance/import/preview`: multipart file XLSX và options JSON gồm choices tùy chọn.
- POST `/api/v1/attendance/import/confirm`: gửi lại cùng file, preview_token, choices và confirm_warnings nếu có cảnh báo.
- POST `/api/v1/attendance/import/errors`: tải file lỗi.
- Headers: employee_code, employee_name (tùy chọn), shift_type, check_in, check_out. Timestamps: YYYY-MM-DD HH:mm:ss theo giờ Việt Nam.
- Preview được ký, gắn với HR và nội dung file/quyết định; hạn 30 phút. Thay dữ liệu nhân viên/lịch/attendance/nghỉ phép/ngày lễ thì phải preview lại khi kết quả đối chiếu thay đổi. Không lưu file hay lịch sử batch.
- Chặn ngày trước hire_date; timestamps tương lai; cặp giờ đảo chiều; vượt khoảng ca cho phép; vượt thời lượng tối đa; khoảng chỉ nằm trong giờ nghỉ; giờ chồng lấn hồ sơ ACTIVE hoặc dòng file (kể cả phần nghỉ giữa ca).
- Giờ làm = khoảng hiện diện trừ giao với nghỉ giữa ca. Tăng ca = thời gian sau cuối ca được gán, trừ giao với nghỉ giữa ca. Đến sớm không tự thành tăng ca; hiển thị cảnh báo. Đây là giờ tăng ca suy từ timestamps, không phải phê duyệt trả lương.
- Trùng ACTIVE khác dữ liệu: lỗi, cần hủy trước. Trùng hệt: bỏ qua. Không ghi đè; thiếu cặp giờ không tạo ABSENT.

## Tổng hợp ngày không có giờ làm

POST `/api/v1/attendance/reconcile/preview`:

```json
{"scope":{"from":"2026-11-01","to":"2026-11-18","employee_ids":[10,11]}}
```

HR chọn 1–100 nhân viên, tối đa 366 ngày/10000 nhân viên-ngày. Chỉ xét ngày làm đã kết thúc theo lịch được gán và không trước hire_date. Ưu tiên holidays ACTIVE -> HOLIDAY; tiếp theo employee_leave_records ACTIVE -> ON_LEAVE. Không có nguồn thì không thêm dòng. Dòng suy ra không có giờ vào/ra, các phút = 0. Ngày đã có attendance ACTIVE được giữ nguyên, thông báo khi có giờ làm hoặc khác trạng thái nguồn. Ngày có đi làm không chuyển thành nghỉ phép.

POST `/api/v1/attendance/reconcile/confirm`: cùng scope, preview_token và confirm_warnings nếu cần. Hệ thống kiểm tra lại nguồn, khóa theo nhân viên rồi mới ghi. Không tự tổng hợp ngay khi import nghỉ phép; HR quyết định phạm vi ở bước này. Không thêm schema.

Hồ sơ nghỉ phép vẫn là nguồn gốc. Trước khi sửa/hủy một hồ sơ nghỉ phép đã tổng hợp, HR cần hủy các dòng ON_LEAVE liên quan để tránh dữ liệu AI lỗi thời, sau đó tổng hợp lại. Không bổ sung audit sửa/hủy nghỉ phép trong thay đổi này.

## Hủy và nhập lại

GET `/:id` trả record_fingerprint. PATCH `/:id/cancel` nhận reason (1–1000 ký tự), expected_fingerprint. Hủy mềm thành CANCEL, lưu người hủy và lý do, ghi audit_logs hiện có. PATCH `/:id` và `/:id/restore` trả 410. Muốn sửa: hủy rồi import bản ghi mới; giữ dòng cũ và audit.

**Ràng buộc database cần được chủ dự án quyết định:** hiện unique index employee_id + work_date áp dụng cả dòng CANCEL. Để giữ dòng đã hủy và tạo dòng mới, unique index cần chỉ áp dụng các dòng ACTIVE. Code không tự sửa index; nếu chưa điều chỉnh sẽ trả lỗi 409 rõ ràng, không ghi đè hay mất lịch sử.

Các câu hỏi về ca đêm và lịch sử thay đổi ca chưa mở rộng trong thay đổi này. AI sick_days hiện đếm ngày attendance ACTIVE có ON_LEAVE; HOLIDAY và CANCEL không được tính.
