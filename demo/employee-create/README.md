# Demo tạo nhân viên

Chạy `npm run dev`, mở http://localhost:3000/employee-create-demo.

1. Đăng nhập tài khoản HR ACTIVE, hoặc dán access token của HR. Token chỉ giữ trong bộ nhớ trang, không lưu vào localStorage.
2. Điền thông tin cá nhân. Chọn phòng ban trước rồi chọn vị trí. Danh sách lấy từ `GET /api/positions?departmentId=...`, chỉ hiện vị trí ACTIVE thuộc phòng ban đã chọn. Đổi phòng ban sẽ xóa lựa chọn vị trí cũ. Phòng ban chưa có vị trí sẽ có thông báo riêng.
3. Gõ địa chỉ để nhận gợi ý Vietmap. Chọn gợi ý có số nhà/tên đường; có thể nhập địa chỉ đầy đủ để backend xác định.
4. Điền ít nhất một bằng cấp. Gõ và chọn trường từ gợi ý ROR/Vietmap. Có thể thêm nhiều bằng cấp. Trường được xác minh lại khi tạo hồ sơ.
5. Thêm kinh nghiệm nếu có. Tháng/năm được chuẩn hóa thành ngày 01 ở backend.
6. Bấm tạo hồ sơ. Trang hiển thị mã nhân viên, trạng thái tài khoản, distance và số bằng cấp/kinh nghiệm. Học vấn/kinh nghiệm được lưu ngay với status IN_PROCESS trong hai bảng hiện có, rồi chuyển sang ACTIVE sau kích hoạt email. Có thể mở JSON để xem id và status của từng bản ghi. Nếu email gửi lỗi, hồ sơ và CV vẫn đã lưu; không tạo lại.

Đăng nhập tài khoản khác sẽ xóa trạng thái và thông tin đang nhập trên trang. Không có mật khẩu/API key được ghi sẵn trong mã demo. Các request gọi backend cùng origin.

## Quan hệ department–position

Backend đã đọc `positions.department_id`, khóa ngoại tới `departments.id`.

- Danh sách và chi tiết position trả thêm `departmentId`. `GET /api/positions` vẫn trả tất cả khi không gửi tham số.
- Tạo thủ công/import nhân viên kiểm tra vị trí thuộc phòng ban trước khi gọi dịch vụ ngoài và kiểm tra lại trong transaction trước khi lưu.
- Cập nhật nhân viên/chuyển vị trí cũng kiểm tra cặp phòng ban/vị trí cho cả hồ sơ ACTIVE và IN_PROCESS.
- Vị trí chưa gắn phòng ban (`department_id IS NULL`) không thể dùng cho hồ sơ mới.
- Không tự thay đổi những cặp department/position không khớp ở dữ liệu nhân viên cũ.

## Kiểm tra

`npm run test:department-position` kiểm tra validation bộ lọc và chặn vị trí sai phòng ban. `npm run test:employee-background:db` dùng bảng tạm sao chép schema thật để kiểm tra truy vấn vị trí theo phòng ban, tạo/cập nhật sai phòng ban và rollback. Dữ liệu nguồn, email và dịch vụ nhà cung cấp không bị thay đổi trong bài test.
