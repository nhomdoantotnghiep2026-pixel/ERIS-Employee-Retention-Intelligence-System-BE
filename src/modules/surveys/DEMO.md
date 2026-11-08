# Demo khảo sát

Mở `http://localhost:3000/survey-demo` sau khi chạy `npm.cmd run dev`. Màn hình gọi API thật và ghi dữ liệu khảo sát thật vào database đang cấu hình.

## Chuẩn bị

- Một tài khoản HR ACTIVE để quản lý đợt khảo sát. HR chưa có employeeId vẫn tạo/sửa/phát hành/xem kết quả được.
- Một tài khoản EMPLOYEE ACTIVE, đã có hồ sơ nhân viên ACTIVE và hire_date đủ 3 tháng theo giờ Việt Nam.
- Database có bộ câu hỏi chung; hiện có 12 câu. Không cần tạo lại câu hỏi khi tạo đợt.
- Mở hai cửa sổ hoặc hai tab: một đăng nhập HR, một đăng nhập EMPLOYEE. Access token được giữ riêng trong bộ nhớ từng trang; không lưu localStorage.

## Kịch bản demo

1. **HR tạo bản nháp:** nhập tên như `DEMO khảo sát tháng 11`. Ngày giờ nhập theo Việt Nam; mặc định bắt đầu trước hiện tại 5 phút, kết thúc sau 24 giờ để demo ngay. Bấm **Tạo bản nháp**. Ghi lại ID xuất hiện trong danh sách.
2. **HR sửa nháp:** bấm **Sửa nháp**, thay mô tả hoặc tên, bấm **Lưu chỉnh sửa**. Chỉ trạng thái DRAFT mới có thao tác này.
3. **HR phát hành:** bấm **Phát hành** rồi xác nhận. Khảo sát chuyển ACTIVE. Nếu đặt bắt đầu trong tương lai thì nhân viên chưa thấy đến khi đúng giờ.
4. **Nhân viên trả lời:** đăng nhập EMPLOYEE ở cửa sổ còn lại, bấm **Tải lại khảo sát**, chọn **Mở để trả lời**. Chọn một điểm nguyên 1–5 cho tất cả 12 câu, thêm nhận xét vài câu rồi bấm **Nộp câu trả lời**.
5. **Nhân viên xem lại:** màn hình hiển thị bài đã nộp và satisfactionScore. Khảo sát đó biến mất khỏi danh sách có thể tham gia. Có thể nhập ID khảo sát vào **Xem bài tôi đã nộp** để mở lại sau khi đăng nhập lại.
6. **HR xem kết quả:** bấm **Tải lại danh sách** → **Xem chi tiết**. Kiểm tra số lượt nộp, điểm trung bình từng câu và số lượt chọn các điểm 1–5.
7. **HR xem một người:** trong danh sách nhân viên tham gia, bấm **Xem câu trả lời**. Màn hình gọi API chi tiết response, hiển thị nhân viên, thời điểm nộp, satisfactionScore và từng điểm/nhận xét.
8. **HR đóng đợt:** bấm **Đóng khảo sát** và xác nhận. Khảo sát chuyển CLOSED, không nhận thêm bài. Nhân viên vẫn xem lại bài cũ bằng ID.

Để kiểm tra tính trung bình nhanh, chọn 5 cho câu đầu và 4 cho 11 câu còn lại. Điểm mong đợi: `(5 + 11 × 4) / 12 = 4.0833`.

## Các tình huống cần trình bày

- Thiếu một câu: màn hình yêu cầu điền đủ; API cũng trả 400 nếu gửi thiếu.
- Mỗi điểm chỉ nhận số nguyên từ 1 đến 5; comment tùy chọn.
- Mỗi người nộp một lần cho một khảo sát; gửi lại nhận 409.
- Khảo sát chưa mở, hết hạn hoặc đã CLOSED không nhận bài.
- Nhân viên chưa đủ 3 tháng không thấy khảo sát để nộp; HR quản lý vẫn dùng được.
- EMPLOYEE không được gọi API xem kết quả của người khác hoặc quản lý khảo sát.
- Giờ nhập ở form chuyển thành ISO có múi giờ +07:00 để không lệch giờ mở/đóng.

## Trigger database cần khớp bộ câu hỏi chung

Hàm `validate_submitted_survey` trong database đã được nhóm cập nhật và kiểm tra lại ngày 05/11/2026: không còn tham chiếu `survey_questions.survey_id`/`required`. Cả hai trigger kiểm tra bài nộp trên survey_answers và survey_responses đang bật. API nộp đủ câu thang 1–5 đã kiểm thử thành công với phiên bản trigger này.

File [surveys-shared-trigger.sql](surveys-shared-trigger.sql) là bản tham khảo đã chuẩn bị trước đó; không cần áp dụng lại khi trigger hiện tại đã hoạt động đúng.

Chạy `npm run test:survey-demo` để kiểm thử cả 12 API trên bảng TEMP theo schema thật, sao chép chính trigger đang dùng từ database, không thay bằng bản sửa mẫu. Có kiểm tra trigger chặn mất một câu trả lời ở thời điểm COMMIT. Không cần file SQL ngoài repo; không tạo bài/khảo sát test trong bảng thật.
