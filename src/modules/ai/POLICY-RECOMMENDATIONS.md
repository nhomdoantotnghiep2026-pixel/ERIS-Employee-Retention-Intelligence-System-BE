**Cập nhật 10/11/2026:** Đã xóa policy sick_days #7 và bỏ nhóm quy tắc sức khỏe theo yêu cầu. Danh mục còn 4 policy; Sick_Days vẫn là feature model nhưng không sinh policy. Những mô tả đề xuất 3 policy trước đây bên dưới là lịch sử thiết kế.

# Đề xuất policy từ kết quả AI đã lưu

API mới: POST /api/ai/results/:id/policy-recommendations. Chỉ HR ACTIVE. ID là predictionId của kết quả model đã lưu, không phải employeeId hoặc snapshotId.

Body mặc định: {"save":false,"limit":3}. limit từ 1 đến 5. API không chạy lại model, không INSERT retention_policies, không tự áp dụng policy. Dùng kết quả model Mexwell thật đã lưu với SHAP xác minh được; không nhận kết quả demo cố định.

## Luồng

1. Xác thực HR từ database; kiểm tra kết quả COMPLETED và nhân viên có hồ sơ/tài khoản ACTIVE.
2. Đọc feature và SHAP của lần dự đoán đó, không tính lại theo hồ sơ hiện tại.
3. Chỉ xét feature có SHAP >0, thuộc nhóm có hành động hỗ trợ phù hợp.
4. Ghép với policy ACTIVE theo target_factor. Tên feature Camel/underscore và tên cột snake_case được chuẩn hóa khi đối chiếu.
5. Gộp Work_Hours_Per_Week và Overtime_Hours thành một đề xuất workload nếu cùng dương; không đề xuất trùng cùng policy.
6. Xếp hạng theo tổng SHAP dương của các feature trong nhóm; mặc định trả 3 đề xuất. Priority hiện MEDIUM cho HR xem xét, không phải mức rủi ro model hay cam kết khẩn cấp.
7. Chưa có policy phù hợp: trả policyDraft và status=AWAITING_POLICY_APPROVAL, không tạo chính sách tự động.

save=false chỉ trả đề xuất. save=true lưu SUGGESTED vào policy_recommendations và audit cho các policy đã có. Gọi lại cùng kết quả/policy không tạo trùng, giữ nguyên trạng thái HR đã duyệt/từ chối. Mỗi lần lưu trong một transaction; lỗi audit sẽ rollback. savedRecommendations cho biết dòng nào được tạo mới. saved=true chỉ biểu thị đã xử lý yêu cầu lưu, không có nghĩa mọi policyDraft đã được thêm.

## Quy tắc demo V1 (quy tắc do backend đặt, không phải model học policy)

| Nhóm | Điều kiện | Hướng đề xuất |
| --- | --- | --- |
| Hài lòng | SHAP hài lòng dương và điểm 1–3 trên thang 1–5 | Trao đổi riêng, xác nhận vấn đề, thống nhất việc cải thiện. |
| Khối lượng | SHAP của giờ làm/tuần hoặc tăng ca dương và giá trị >0 | Rà soát giờ làm và phân bổ, không tự kết luận tăng ca vượt chuẩn. |
| Thu nhập | SHAP Monthly_Salary dương | Rà soát thu nhập/phúc lợi; không khẳng định lương thấp hoặc tự tăng lương. |
| Nghề nghiệp | SHAP Promotions hoặc Years_At_Company dương; Promotions=0 và thâm niên >=1 năm | Trao đổi lộ trình, tiêu chí phát triển; không tự thăng chức. |
| Sức khỏe | SHAP Sick_Days dương và số ngày >0 | Trao đổi nhu cầu hỗ trợ, không suy đoán bệnh lý hoặc xử phạt. |

Không dùng Age, Gender, Hire_Date, Department, Education_Level để đề xuất đổi nhân sự. SHAP âm không kích hoạt policy. Điểm hài lòng test 0.1 được giữ nguyên khi chạy model, nhưng ngoài miền khảo sát 1–5 nên không tự suy ra policy hài lòng. excludedFactors giải thích các yếu tố dương bị bỏ qua.

Nếu không có yếu tố phù hợp, trả danh sách rỗng; không ép đủ 3 policy. Lý do mỗi đề xuất ghi feature, giá trị, SHAP theo điểm phần trăm và nguồn dữ liệu snapshot (kể cả MANUAL_DEMO).

## Danh mục trên database mới

Đã đọc database eris tại 10.148.0.2:15432 ngày 10/11/2026. Có sẵn hai policy ACTIVE:

- DEMO_REVIEW_WORKLOAD: Rà soát khối lượng công việc (overtime_hours).
- DEMO_SATISFACTION_CHECKIN: Trao đổi về mức độ hài lòng (employee_satisfaction_score).

Ba policy đề nghị bổ sung: RETENTION_COMPENSATION_REVIEW, RETENTION_CAREER_DEVELOPMENT, RETENTION_WELLBEING_SUPPORT. Người dùng đã duyệt ngày 10/11/2026; đã thêm 3 policy ACTIVE với ID lần lượt 5, 6, 7. File proposed-policies.sql đã thực thi; không thêm trùng nếu chạy lại. Không thêm bảng/cột.

## Demo

Mở /ai-demo → chạy model và lưu kết quả, hoặc tải predictionId đã lưu → bấm Đề xuất policy. Có nút riêng để lưu đề xuất cho policy đã có. Policy chưa có ghi chờ duyệt; nút này không thêm retention_policies.

Các API đọc cũ /api/policy-recommendations và /api/retention-policies tiếp tục dùng được để frontend hiển thị dữ liệu đã lưu.

## Giới hạn

Model vẫn NO_QUALIFIED_MEXWELL_MODEL. Đây là gợi ý để thiết kế luồng HR và demo, không phải quyết định tự động hoặc chứng minh chính sách sẽ giảm nghỉ việc. Không tự thay đổi lương/chức danh/lịch làm; cần HR xác nhận tình huống và nguồn dữ liệu trước khi áp dụng.

Kiểm thử: npm run test:ai-policy (rules, quyền HTTP, preview không ghi, lưu lặp, rollback giả lập); npm run test:ai-policy:db (transaction thực trên bảng TEMP PostgreSQL sao chép cấu trúc policy hiện có, không thêm dữ liệu nghiệp vụ thật).
