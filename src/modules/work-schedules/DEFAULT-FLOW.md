# Lịch mặc định và lịch riêng

Hai API dành cho HR ACTIVE:

- `POST /api/work-schedules/default`: gửi thông tin giờ làm, nghỉ trưa, ngày làm trong tuần, tên và trạng thái ACTIVE. Không gửi ngày hiệu lực. Hệ thống tự chọn ngày mai theo giờ Việt Nam.
- `POST /api/work-schedules/individual`: cùng các thông tin giờ, thêm `employee_id`, `effective_from` và `effective_to` bắt buộc. Tạo lịch mẫu và gán trong một transaction.

API `POST /api/work-schedules` cũ vẫn tạo mẫu lịch để tương thích. `PATCH /api/work-schedules/{id}/default` cũng chuyển sang hẹn áp dụng từ ngày mai, không đổi ngay hôm nay.

## Quy tắc lưu lịch sử

Phân biệt theo `schedule_id` của lịch đang có `is_default=true`, theo quy tắc nhóm chọn; không thêm bảng/cột. Cùng ID với lịch mặc định được coi là theo mặc định. Muốn lịch riêng thì chọn mẫu lịch khác.

Khi tạo mặc định mới, hệ thống lưu các dòng gán trong `employee_schedule_assignments` cho nhân viên ACTIVE. Lịch cũ kết thúc ngày trước ngày mới bắt đầu: lịch mới từ 15/11 thì lịch cũ kết thúc 14/11. Các khoảng lịch riêng được giữ nguyên; nếu có ngày kết thúc, sau đó quay lại mặc định mới. Nếu có lịch riêng trong tương lai, các phần mặc định được chia thành đoạn trước và sau khoảng đó để không chồng lấn.

Không tạo dòng mặc định mới cho người INACTIVE. Chỉ đóng phần đuôi lịch mặc định cũ của họ, để khi tái kích hoạt không quay lại một lịch mặc định đã thay.

Đối với nhân viên trước đây dùng fallback mà chưa có dòng lịch sử, hệ thống chỉ ghi từ ngày đang đồng bộ; không tự suy đoán những ngày quá khứ chưa có dữ liệu.

## Áp dụng từ ngày mai

Cờ mặc định cũ giữ nguyên hôm nay. Đến ngày mai hệ thống mới chuyển `is_default`. Lệnh chờ lưu trong Redis, có sự kiện audit SQL đã commit để phục hồi nếu mất cache. Không giữ transaction chờ qua ngày. Mỗi lần chỉ có một lệnh đổi mặc định đang chờ; lần tiếp theo trả 409.

Server kiểm tra khi khởi động và mỗi 60 giây. Request attendance của người có hồ sơ ACTIVE cũng đồng bộ trước khi đọc hoặc ghi. Nhân viên ACTIVE mới chưa có dòng gán được bổ sung lịch mặc định của ngày hiện tại. Các bản ghi attendance đã lưu không tự tính lại.

## Gán và xóa lịch riêng

Gán riêng vào một khoảng đang theo mặc định sẽ tách phần mặc định trước/sau. Chặn chồng lịch riêng khác và chặn thay ngày đã có attendance.

API DELETE chỉ dùng cho lịch riêng chưa sử dụng. Không xóa trực tiếp các dòng đang theo mặc định hoặc chờ áp dụng mặc định. Gán một lịch riêng khác là cách thay thế khoảng mặc định.

## Response cho frontend

Tạo mặc định trả `data.scheduled=true`, `effective_from`, `effective_to=null`, `affectedEmployees`, `skippedEmployees`, `preservedIndividualEmployees`.

Danh sách lịch trả thêm `pending_default.effective_from` cho lịch đang chờ. Lịch đang chờ không phải lịch có hiệu lực hôm nay.

Màn hình `/work-schedules-demo` có hai lựa chọn tạo mặc định hoặc riêng. Màn hình `/attendance-demo` đọc dòng gán có hiệu lực trong ngày.

## Kiểm thử

Chạy `npm.cmd run test:work-schedules-default-history`. Test HTTP và PostgreSQL TEMP kiểm tra áp dụng tương lai, trạng thái ACTIVE/INACTIVE, giữ lịch riêng, cập nhật mặc định sau khi hết riêng, phục hồi lệnh Redis, rollback và tính giờ attendance. Test không ghi dữ liệu vào bảng nghiệp vụ thật.
