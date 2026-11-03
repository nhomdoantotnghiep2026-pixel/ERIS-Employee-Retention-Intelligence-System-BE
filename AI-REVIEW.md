# Demo AI trên nhánh review-ai

Chạy từ repo BE:

```powershell
npm.cmd run demo:ai-review
```

Mở http://localhost:3100/ai-review-demo, đăng nhập bằng HR ACTIVE.
Docker Desktop phải đang chạy và cần image `eris-model-review:local` đã được build
trên máy này. Script tự tạo service key, truyền qua biến môi trường, nạp model rồi
chạy backend ở cổng 3100; không sửa .env. Ctrl+C dừng cả backend và container tạm.
Có thể đặt REVIEW_AI_PORT để đổi cổng. Giữ terminal đang chạy khi demo.

## Demo có gì?

- Hai model thật: Random Forest B2 và AdaBoost S1, schema v3_final_15.
- Nút chạy hồ sơ giả lập cố định: model thật, không phải dữ liệu nhân viên.
- Danh sách hồ sơ ERIS: đủ điều kiện có nút dự đoán, còn lại hiển thị lý do đầu tiên bị loại.
- Kết quả: xác suất, 15 feature, tỷ giá, kỳ tăng ca, top SHAP và response JSON.
- SHAP hiển thị biểu đồ hai phía (cam tăng, xanh giảm), mức tham chiếu và chi tiết đủ 15 feature.
- Nút “Chạy 10 hồ sơ giả lập” gọi batch model một lần. Bảng trả xác suất từng mẫu;
  chọn “Xem / SHAP” để chạy lại đúng mẫu và lấy giải thích, không xếp hàng 10 SHAP cùng lúc.
- Nút chạy nhân viên đủ điều kiện chọn tối đa 100 ID đầu tiên; dữ liệu được kiểm tra lại khi chạy.
- Model chỉ nhận opaque UUID làm reference, không nhận tên/email/mã nhân viên.
- HR không được chạy dự đoán bản thân. Role/status được đọc lại từ database.
- Token demo chỉ ở bộ nhớ, đổi phiên xóa dữ liệu cũ. Không lưu mật khẩu vào localStorage.

Đây là review/demo: không lưu vào model_run, ai_input, prediction_results, explainable;
không tạo bảng/cột và không chỉnh dữ liệu nguồn. Không phân loại High/Medium/Low hoặc
khẳng định thời hạn nghỉ việc. SHAP không chứng minh quan hệ nhân quả.

## Quy tắc chuyển đổi

- Chỉ ACTIVE profile + account, phòng ban + vị trí ACTIVE. Tên phòng ban nhận chính xác
  Human Resources, Research & Development, Sales; không ép phòng ban khác thành ba nhóm này.
- Tuổi/năm thâm niên là năm tròn tại ngày Việt Nam. 29/02 quy về 28/02 trong năm không nhuận.
- Km làm tròn gần nhất. Education ACTIVE cao nhất: mã ERIS 1–4 đổi thành mã model 2–5.
- Lương vẫn VND ở DB; USD = VND / VND-per-USD, làm tròn số nguyên.
- Tỷ giá từ [ExchangeRate-API](https://www.exchangerate-api.com), endpoint công khai
  https://open.er-api.com/v6/latest/USD. Cache bộ nhớ tối đa 1 giờ, tuổi dữ liệu tối đa 72 giờ.
  Một lần chuẩn bị đầu vào dùng một tỷ giá. Nguồn lỗi thì báo thiếu; không dùng tỷ giá giả.
- Tăng ca tổng tháng hoàn tất gần nhất: >0 là Yes; =0 là No. Không có bản ghi hoặc
  có lần check-in chưa check-out thì báo thiếu. Không khẳng định tháng đã đầy đủ ngày làm.
- Survey đã nộp mới nhất: đủ JS01–04 và ES01–04, trung bình riêng rồi Math.round về 1–4.
  Không tự quay về survey cũ nếu survey mới nhất thiếu, chưa giới hạn tuổi khảo sát.
- TotalWorkingYears gộp khoảng kinh nghiệm ACTIVE với khoảng hireDate→hôm nay; không cộng trùng.
  End date kinh nghiệm tính gồm ngày kết thúc; chưa kết thúc thì cắt tại hôm nay.
- YearsInCurrentRole tính từ lần đổi positionId gần nhất, gồm PROMOTION.
  YearsSinceLastPromotion tính từ PROMOTION gần nhất. Chưa có lịch sử/thăng chức dùng hireDate.
- TrainingTimesLastYear và YearsWithCurrManager null; fitted pipeline của model xử lý.

API GET inputs chỉ cho biết dữ liệu hiện tại. POST predict luôn đọc lại, không nhận features
do client sửa; vì dữ liệu/tỷ giá có thể đổi nên đầu vào POST có thể khác preview.
Thiếu dữ liệu thì không tự tạo hồ sơ/chấm công/survey giả để dự đoán.

## API (Swagger: nhóm AI Review)

| Method | Endpoint | Mục đích |
|---|---|---|
| GET | /api/ai-review/models | Trạng thái hai model |
| GET | /api/ai-review/inputs | Hồ sơ, feature hợp lệ hoặc lý do bị loại |
| POST | /api/ai-review/predict | employeeId, modelId, includeExplanation |
| POST | /api/ai-review/sample | modelId, includeExplanation; dùng mẫu cố định |
| POST | /api/ai-review/sample/batch | modelId; chạy 10 hồ sơ giả lập |
| POST | /api/ai-review/predict/batch | employeeIds (1–100, không trùng), modelId |

POST /sample nhận sampleIndex từ 0 đến 9 để chọn mẫu. Kết quả batch có cùng thứ tự
những hồ sơ hợp lệ trong danh sách yêu cầu, các hồ sơ bị loại nằm trong skipped.
Batch predict có lỗi upstream thì trả lỗi cả lần gọi, không làm giả kết quả từng dòng.
SHAP lấy sau bằng /sample hoặc /predict. Với nhân viên thật, lần gọi sau đọc lại dữ liệu,
nên có thể khác snapshot batch; giao diện/response ghi rõ hành vi này.

Chỉ HR ACTIVE. Kết quả không cache. includeExplanation mặc định true;
predict thành công nhưng explain lỗi vẫn trả xác suất với explanationError.
Chờ predict tối đa 15s, explain tối đa 65s; service model có giới hạn hàng đợi riêng.

## Chạy với service model tự quản lý

Thêm AI_MODEL_BASE_URL và AI_MODEL_SERVICE_KEY vào môi trường chạy BE, rồi npm.cmd run dev.
Service Python phải dùng entrypoint eris_ml.api_b2.main:app (không phải API V1 cũ).
Key BE phải khớp ERIS_SERVICE_API_KEY của service Python, không phải JWT_SECRET.
Không đưa key vào frontend, Git, URL hoặc response.

Nếu đổi máy, build image từ repo model có hai bộ artifact hợp lệ:

```powershell
docker build -f deploy/api_b2/Dockerfile -t eris-model-review:local .
```

File model không nằm trong repo BE; nhận qua kênh riêng. Không commit bundle hoặc dataset.

## Kiểm tra

```powershell
npm.cmd run check
npm.cmd run test:ai-review
```

Test HTTP dùng dữ liệu giả lập/dependency injection; không ghi database nghiệp vụ.
Kết quả model thật từ lần chạy phải được phân biệt với các test giả lập này.
