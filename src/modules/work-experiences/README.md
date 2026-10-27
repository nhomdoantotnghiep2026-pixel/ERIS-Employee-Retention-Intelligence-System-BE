# Học vấn và kinh nghiệm nhân viên

## Luồng tạo và kích hoạt

Khi HR tạo hồ sơ bằng `POST /api/employees` hoặc import Excel:

- Lưu tài khoản và hồ sơ với trạng thái `IN_PROCESS`.
- Lưu các bằng cấp vào `employee_educations` và kinh nghiệm vào `employee_work_experiences`, cũng với `status = IN_PROCESS`.
- Tất cả lưu trong cùng transaction PostgreSQL. Một phần lỗi thì toàn bộ hồ sơ đó rollback. Email gửi sau commit.
- Chưa tạo bản ghi HIRE. Không có bảng/cột mới; không dùng Redis lưu bản nháp CV.

Khi nhân viên xác minh OTP và đặt mật khẩu thành công, một transaction:

1. Chuyển tài khoản và hồ sơ sang ACTIVE.
2. Chuyển các bằng cấp/kinh nghiệm của người đó từ IN_PROCESS sang ACTIVE và cập nhật updated_at.
3. Tạo HIRE nếu chưa có, lấy phòng ban/vị trí/ngày vào làm từ employees; end_date và manager_id NULL.

Chỉ đổi các bản ghi IN_PROCESS, giữ nguyên ACTIVE và INACTIVE. Lỗi kích hoạt rollback cả trạng thái tài khoản/hồ sơ/CV và HIRE. Đổi mật khẩu sau khi đã ACTIVE không tạo bản ghi CV hoặc HIRE mới.

Nếu hồ sơ liên kết tài khoản HR đã ACTIVE, học vấn/kinh nghiệm và HIRE lưu ngay khi tạo hồ sơ. API thêm bằng cấp riêng tiếp tục dùng để bổ sung bằng mới cho nhân viên đã ACTIVE, mặc định bản ghi mới ACTIVE.

## Dữ liệu tạo nhân viên

Ngoài 11 trường hồ sơ hiện có, gửi hai mảng:

```json
{
  "educations": [{
    "educationLevel": 2,
    "fieldOfStudy": "Công nghệ thông tin",
    "institution": "Tên trường đã chọn từ gợi ý",
    "institutionRefId": "ID trường từ gợi ý",
    "graduationYear": 2022
  }],
  "workExperiences": [{
    "companyName": "Công ty ABC",
    "positionTitle": "Backend Developer",
    "startDate": "2022-06",
    "endDate": "08/2025"
  }]
}
```

Đây là phần bổ sung vào request đầy đủ. Không gửi status hoặc ID bản ghi con; backend tự đặt theo tài khoản. `educations` có 1–20 bản ghi; `workExperiences` có 0–50, dùng `[]` nếu chưa có kinh nghiệm.

Học vấn dùng cùng validation với API thêm bằng cấp: bậc 1–4, trường được chọn và xác minh qua ROR/Vietmap; năm tốt nghiệp nếu nhập phải từ năm sinh + 21 đến năm hiện tại. `fieldOfStudy` và `graduationYear` theo quy tắc hiện có, có thể bỏ qua. Cảnh báo bậc/trường không khớp vẫn được trả ở từng bằng cấp.

Kinh nghiệm bắt buộc companyName, positionTitle, startDate. endDate có thể bỏ qua/null. Ngày nhận YYYY-MM-DD, YYYY-MM hoặc MM/YYYY; nếu chỉ có tháng/năm thì lấy ngày 01. Chặn ngày sai, ngày tương lai, ngày bắt đầu trước/ngay ngày sinh, endDate trước startDate và dòng kinh nghiệm trùng trong cùng request.

Response trả `educations` và `workExperiences` với id/status thật từ database. `backgroundStatus` là giá trị tính cho response: PENDING_ACTIVATION nếu còn bản ghi IN_PROCESS, SAVED nếu đã lưu trạng thái hoạt động; không thêm cột cho giá trị này. Không có pendingBackground riêng.

HR xem GET /api/employees/{id} của hồ sơ IN_PROCESS sẽ thấy các bản ghi CV IN_PROCESS và ACTIVE, không thấy INACTIVE. Các API danh sách học vấn/kinh nghiệm thông thường và API xem của chính nhân viên vẫn chỉ trả ACTIVE của hồ sơ/tài khoản ACTIVE.

## Import Excel

File .xlsx tối đa 5 MB, 200 nhân viên. Dùng một trong hai cách:

| Sheet (cách 3 sheet) | Cột |
|---|---|
| Employees | fullName, email, phone, dateOfBirth, gender, address, departmentId, positionId, hireDate, employmentType, currentSalary |
| Educations | email, educationLevel, fieldOfStudy, institution, institutionRefId, graduationYear |
| WorkExperiences | email, companyName, positionTitle, startDate, endDate |

Email liên kết không phân biệt hoa/thường. Mỗi người có thể có nhiều dòng ở hai sheet con; cần ít nhất một bằng cấp. Nếu chưa có kinh nghiệm, giữ header WorkExperiences và không thêm dòng cho người đó. Không nhận dòng con có email không có trong Employees.

Hoặc dùng một sheet với 11 cột hồ sơ và hai cột educations/workExperiences chứa mảng JSON dạng Text. Không dùng công thức/hyperlink; phone nên là Text để giữ số 0 đầu. Ngày sinh/ngày vào làm nhận YYYY-MM-DD hoặc ô Date Excel; kinh nghiệm còn nhận tháng/năm.

Mỗi nhân viên có transaction riêng, dùng chung validation và trạng thái với tạo thủ công. Dòng lỗi không hủy dòng thành công. Xem results/created/failed, không chỉ HTTP 200. emailDelivery FAILED vẫn đã lưu hồ sơ/CV, không import lại.

## API kinh nghiệm

| Method | Endpoint | Chức năng |
|---|---|---|
| GET | /api/employee-work-experiences | HR xem tất cả kinh nghiệm ACTIVE của hồ sơ/tài khoản ACTIVE |
| GET | /api/employees/{employeeId}/work-experiences | HR xem kinh nghiệm ACTIVE của một nhân viên |
| DELETE | /api/employees/{employeeId}/work-experiences/{experienceId} | HR xóa mềm: INACTIVE, cập nhật updated_at |

HR không tự xóa kinh nghiệm của mình. Không có bộ lọc/phân trang.

## Demo và kiểm tra

Demo: http://localhost:3000/employee-create-demo sau khi chạy npm run dev. Chọn phòng ban trước, sau đó chọn vị trí ACTIVE thuộc phòng ban; vị trí có department_id NULL không được dùng.

`npm run test:employee-background` kiểm tra validation/import trong bộ nhớ. `npm run test:employee-background:db` dùng bảng tạm sao chép cấu trúc PostgreSQL để kiểm tra IN_PROCESS, import, rollback khi tạo/kích hoạt, giữ nguyên INACTIVE, cập nhật đúng nhân viên và không tạo trùng HIRE/CV. Không cần Redis cho bài test này; email/bản đồ/trường học được giả lập. Redis vẫn được hệ thống dùng cho OTP/phiên đăng nhập như trước.
