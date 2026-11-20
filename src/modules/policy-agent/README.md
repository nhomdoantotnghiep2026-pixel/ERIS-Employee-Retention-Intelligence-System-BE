# Policy agent — preview only

Màn hình backend: http://localhost:3000/policy-agent-demo (dùng port backend thực tế nếu khác 3000). Repo frontend không thay đổi.

Luồng HR: đăng nhập bằng tài khoản HR ACTIVE -> chọn nhân viên và khoảng ngày -> chọn survey đã nộp và/hoặc attendance -> xem đầu vào -> xác nhận gửi dữ liệu -> xem gợi ý, bằng chứng và nội dung cần xác minh. Nội dung phản hồi và kết quả được hiển thị bằng textContent, không render HTML từ nhân viên hoặc agent. Token chỉ giữ trong bộ nhớ trang.

API, đều yêu cầu Bearer token HR ACTIVE:
- GET /api/policy-agent/options: employees, surveys có phản hồi, trạng thái cấu hình. Không trả API key.
- POST /api/policy-agent/context: chỉ đọc, không gọi agent. Body {employeeId,from,to,surveyIds:[],includeAttendance:true}. Khoảng ngày tối đa 366, không tương lai. Survey tính theo ngày submitted; attendance theo work_date. Chỉ lấy câu hỏi thuộc survey đã chọn và câu trả lời của đúng nhân viên. Gửi tối đa 10 survey/200 câu trả lời/1000 dòng attendance/100 policy ACTIVE; từ chối khi đầu vào vượt 80 KB, không âm thầm cắt dữ liệu.
- POST /api/policy-agent/preview: cùng phạm vi, thêm inputFingerprint từ context và confirmExternalData:true. Trước khi gọi dịch vụ sẽ so khớp đầu vào đã hiển thị. Sau khi dịch vụ trả về kiểm tra lại dữ liệu. Thay đổi nguồn/policy -> 409. Một yêu cầu đang chạy/HR. Không lưu.

Chưa nối provider hoặc model dự đoán. Để URL/model/key trống thì context hoạt động nhưng preview trả 503 rõ ràng, không dùng gợi ý giả hay keyword fallback. Adapter hiện cung cấp giao thức HTTP chat JSON để dễ thay thế khi nhóm trưởng chọn dịch vụ; không mặc định nó là model dự đoán nghỉ việc.

Khi đã chọn dịch vụ tương thích giao thức đó, cấu hình ở môi trường backend (không commit key):
```
POLICY_AGENT_URL=https://<trusted-service>/<chat-endpoint>
POLICY_AGENT_MODEL=<selected-agent-model>
POLICY_AGENT_API_KEY=<server-side-key>
```
Provider phải nhận model/messages/response_format và trả choices[0].message.content là JSON, finish_reason=stop. Dịch vụ dùng giao thức khác chỉ cần thay Provider.generate hoặc inject provider vào PolicyAgent; giữ nguyên lớp kiểm tra bằng chứng và phân quyền. Chưa thực hiện hoặc xác minh kết nối đến nhà cung cấp thật.

Đầu ra: tối đa 3 policy từ danh mục hiện tại, reason, evidence thực tế, hrVerification. Cho phép trả danh sách rỗng kèm lý do. Backend chặn policy ID/bằng chứng bịa, trùng policy, JSON sai, phản hồi thiếu và kết quả cũ. Căn cứ tồn tại không bảo đảm nội dung agent luôn suy luận đúng; HR vẫn phải kiểm tra trước khi áp dụng. Lỗi upstream không trả nội dung chứa key/payload cho client. Không dùng age/gender hay số ngày nghỉ để kết luận ý định nghỉ, bệnh hoặc vi phạm.

Attendance dùng các chỉ số đã lưu trên từng bản ghi và lịch được liên kết hiện tại; không khẳng định coverage toàn kỳ hay lịch sử cấu hình ca. Ngày không có bản ghi không được suy ra vắng mặt. Chưa tích hợp model; request không nhận predictionId hoặc dữ liệu model do client tự gửi. Sau này thêm nguồn model ở backend từ kết quả/snapshot đã lưu và tái kiểm tra quyền, không dùng JSON model tùy ý từ browser.

Chưa có confirm/save: policy_recommendations.prediction_result_id đang NOT NULL. Theo quyết định của người dùng, đợi nhóm trưởng sửa schema rồi mới triển khai lưu độc lập cho survey/attendance; không tạo prediction giả để lách FK. Không tự tạo bảng/cột, migration, seed hoặc audit ghi dữ liệu khi preview.

Kiểm thử mock, không ghi database: node --test test/policy-agent.test.cjs. Không cần cấu hình agent thật để chạy test.
