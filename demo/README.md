# Demo API ERIS

Chạy `npm.cmd run dev` tại thư mục backend, mở http://localhost:3000/demo.

| Màn hình | Địa chỉ |
| --- | --- |
| Trang demo chung: tài khoản, import, vị trí, khảo sát và đọc dữ liệu | `/demo` |
| Tạo hồ sơ nhân viên, gợi ý địa chỉ và trường học | `/employee-create-demo` |
| Quản lý bằng cấp | `/employee-education-demo` |
| Attendance: Excel Import, Preview, Confirm và Audit | `/attendance-demo` |
| Chọn địa điểm công ty | `/company-location-demo` |

## Cách thử

1. Đăng nhập bằng tài khoản hiện có. Trang chung hiển thị các chức năng theo role mà API `/api/auth/me` trả về.
2. ADMIN có thể tạo HR bằng email và `full_name`. HR dùng form vị trí, import hoặc khảo sát. EMPLOYEE có thể mở khảo sát và gửi điểm/nhận xét khi đủ điều kiện do backend kiểm tra.
3. Tài khoản IN_PROCESS có phần nhập OTP và mật khẩu mới để kích hoạt, sau đó đăng nhập lại.
4. Với nhân viên thủ công, chọn phòng ban trước rồi chọn vị trí ACTIVE thuộc phòng ban đó. Hồ sơ gồm học vấn, không còn kinh nghiệm làm việc.
5. Import dùng workbook hai sheet `Employees`, `Educations`, liên kết bằng email; hoặc một sheet có cột `educations` chứa JSON. File ba sheet cũ có `WorkExperiences` không được hỗ trợ.
6. Attendance: chạy `npm run db:migrate:attendance`, đăng nhập HR, mapping `shift_type` cho Work Schedule rồi upload Excel. Preview không ghi Attendance; HR xác nhận trước khi lưu. Employee chỉ xem dữ liệu bản thân. Xem hướng dẫn tại `src/modules/attendance/README.md`.

Mỗi màn hình đăng nhập riêng. Token chỉ giữ trong bộ nhớ trang. Tải lại trang cần đăng nhập lại. Bấm tạo, import, gửi khảo sát hoặc chấm công sẽ gọi API thật, ghi vào database đang cấu hình và có thể gửi email thật; nên dùng dữ liệu test.

## Kiểm tra

`npm.cmd run check` kiểm tra cú pháp. `npm.cmd run test:demo-contracts` kiểm tra hợp đồng form, import và repository bằng fixture; không gửi email thật.

Luồng trình duyệt cũ đã được thử với ứng dụng Express và SQL thật trong database PGlite cô lập dựng từ metadata schema hiện tại. Redis, email, Vietmap/ROR, thời gian và GPS được giả lập trong lượt kiểm thử đó. Kết quả cũ không áp dụng cho giao diện Attendance Excel vừa thay thế. Backend Attendance mới có bộ test PostgreSQL/HTTP riêng: `npm run test:attendance`; giao diện cần kiểm tra trực tiếp trên trình duyệt.

Không tạo bảng/cột mới. Model AI cũ ở nhánh review-ai chưa được đưa vào màn hình của nhánh này.
