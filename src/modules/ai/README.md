# Luồng snapshot → model (cập nhật)

## Demo dữ liệu hiện có của employee #2

1. Mở http://localhost:3000/ai-demo, Ctrl+F5 và đăng nhập HR.
2. Chọn employee #2. Màn hình tự tải snapshot #3 từ bảng ai_input; cũng có nút Tải snapshot đã có.
3. Xem dữ liệu ở khung JSON. Điểm hài lòng 0.1000 được gửi thành JSON number 0.1, giữ nguyên theo yêu cầu test. UI ghi cảnh báo ngoài thang khảo sát 1–5; không áp dụng giá trị này làm quy tắc cho khảo sát thật.
4. Bấm Chạy model + SHAP. Không cần Kiểm tra/tạo snapshot vì dữ liệu đã có.
5. Tùy chọn lưu chỉ lưu kết quả, SHAP và audit, tham chiếu lại snapshot #3; không tạo thêm ai_input.

Đã thử snapshot #3 qua backend → Python thật với save=false: score khoảng 0.159961 (15.9961%), 12 SHAP. Đây là test model demo, không phải đánh giá nhân sự.

## Luồng tạo snapshot mới

- Nút Kiểm tra và tạo snapshot tổng hợp từ hồ sơ và các nguồn đã mô tả bên dưới, cộng chỉ số HR bổ sung.
- Thiếu feature: trả missingFeatures, snapshotCreated=false, không tạo ai_input hay audit snapshot.
- Đủ 12 feature hợp lệ: INSERT một snapshot trong ai_input và audit AI_INPUT trong cùng transaction; trả snapshotId.
- Bấm kiểm tra lại khi đủ sẽ tạo snapshot mới (không ghi đè snapshot cũ).
- Chạy model chỉ nhận snapshotId và save. Đọc lại đúng row thuộc employeeId, không tính lại từ hồ sơ và không nhận supplementalFeatures trong yêu cầu dự đoán nữa.
- Thiếu/sai feature ở snapshot thì không gọi model. Riêng điểm hài lòng 0–<1 trong snapshot có sẵn được cho phép phục vụ thử nghiệm theo yêu cầu, gắn outOfDomainFeatures; các giá trị âm/không hữu hạn vẫn bị chặn.
- Lưu kết quả kiểm tra snapshot không bị sửa trong lúc chờ AI; nếu thay đổi thì rollback và yêu cầu chạy lại. Các field risk_level/prediction_label vẫn NULL.

## Request hiện tại

~~~http
GET /api/ai/employees/2/snapshots
GET /api/ai/employees/2/snapshots/3
POST /api/ai/employees/2/predict
Content-Type: application/json
Authorization: Bearer <access-token-HR>

{"snapshotId":3,"save":false}
~~~

Batch: {"employees":[{"employeeId":2,"snapshotId":3,"save":false}]}. Mỗi người phải có snapshot của chính họ.

POST /api/ai/employees/:employeeId/preview có thể ghi snapshot nếu đầy đủ. UI và Swagger đã cập nhật. GET /api/ai/results/:id xem lại kết quả đã lưu; GET /api/ai/model kiểm tra service; GET /api/ai/employees xem danh sách ACTIVE. Các API chỉ cho HR ACTIVE, kiểm tra quyền trực tiếp trong database.

## Khởi động và cấu hình

Bật Docker Desktop, Redis và tunnel database. Chạy npm run ai:start rồi npm run dev. AI chạy localhost:8000 trong container eris-ai-mexwell. Các biến AI_SERVICE_URL, AI_SERVICE_KEY, AI_SERVICE_TIMEOUT_MS trong .env; key dùng chung giữa BE và Python, không đưa ra frontend. ZIP model lấy từ Downloads mặc định, giải nén runtime vào .local/ai-service và không commit artifact/key. Không thêm bảng/cột database.

## Nguồn dữ liệu khi tạo snapshot

Department/Gender/Hire_Date từ hồ sơ; Age và Years_At_Company tính năm tròn tại snapshot; Education_Level lấy bằng ACTIVE cao nhất; Promotions đếm PROMOTION đến snapshot. Satisfaction lấy trung bình các answers của response đã nộp gần nhất không sau snapshot, làm tròn 2 chữ số; chưa nộp thì thiếu feature. Lương VND chỉ đổi USD nếu HR cung cấp vndPerUsd. SupplementalFeatures chỉ bổ sung feature thiếu cho demo, không ghi đè dữ liệu database.

Work_Hours_Per_Week lấy lịch ACTIVE tại snapshot: (end_time - start_time - thời gian nghỉ giữa ca) nhân số ngày làm việc khác nhau trong tuần; ưu tiên assignment rồi default, không có lịch hợp lệ thì thiếu feature. Đây là giờ hành chính theo lịch, không gồm overtime.

Overtime_Hours = tổng overtime_minutes của attendance thực làm đã checkout / 60, làm tròn 2 chữ số. Sick_Days giữ tên cũ để tương thích model nhưng mang nghĩa tổng ngày nghỉ phép + không phép: đếm DISTINCT work_date có ON_LEAVE/ABSENT, đúng ngày làm theo lịch và không thuộc holiday ACTIVE. Hai chỉ số tính từ max(01/01 năm snapshot, hire_date) đến snapshot, không dùng 12 tháng lùi. Checkout chưa hoàn tất làm thiếu Overtime_Hours. Không cộng thêm leave_requests để tránh trùng ngày; chỉ tính ngày nghỉ đã được materialize vào attendance. Công tác hiện chưa có loại dữ liệu riêng: không được ghi công tác thành ON_LEAVE/ABSENT, nếu ghi như vậy thì chưa thể phân biệt khi thống kê.

periodStart/periodEnd được giữ để tương thích request và metadata cũ; không thay đổi cửa sổ YTD hay lịch dùng tính các feature trên. Snapshot đã lưu không bị tính lại. Cách tính absence và overtime này khác định nghĩa dataset gốc; cần đồng bộ cách chuẩn bị dữ liệu huấn luyện trước khi dùng ngoài demo.

## Lưu kết quả

Khi save=true, tạo model_run COMPLETED, prediction_results và 12 explainable, audit AI_PREDICTION trong một transaction. Dùng snapshotId có sẵn, không INSERT lại ai_input. Audit chứa nguồn dữ liệu, base value và metadata model. Sai ở bước nào rollback kết quả ở bước đó, snapshot đã tạo ở bước kiểm tra vẫn giữ lại.

## Kiểm thử và giới hạn

npm run test:ai: test mapping, thiếu feature không tạo snapshot, kiểm tra model/SHAP, phân quyền, batch 2 worker và PostgreSQL TEMP transaction/rollback.

npm run test:ai:smoke: Express thật → Python thật, chọn snapshot đã lưu, save=false, không tạo domain data. Không tự tạo snapshot nếu DB chưa có snapshot hoàn chỉnh.

Model mexwell-rf12-demo-v1-20e0a090ced2 có schema mexwell-12-v1 và validation_status NO_QUALIFIED_MEXWELL_MODEL. ROC-AUC OOF ~0.504, chưa đạt chất lượng dự báo; dùng demo kỹ thuật. Không tự gán mức rủi ro, không tự sinh policy. SHAP là xác suất: 0.01 = 1 điểm phần trăm, không xác nhận nguyên nhân. Model không có horizon 90 ngày.

