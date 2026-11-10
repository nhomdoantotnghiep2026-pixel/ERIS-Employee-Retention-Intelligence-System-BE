-- Ngày 10/11/2026: đã thêm policy thu nhập/nghề nghiệp; policy sick_days đã xóa theo yêu cầu.
-- Script có thể chạy lại an toàn theo code (ON CONFLICT DO NOTHING).
-- Hai policy workload/satisfaction đang có sẽ được tái sử dụng, không thêm trùng.
BEGIN;
INSERT INTO retention_policies(code,name,description,target_factor,status) VALUES
('RETENTION_COMPENSATION_REVIEW','Rà soát thu nhập và phúc lợi',
 'HR rà soát thu nhập theo chức danh, cấp bậc, mặt bằng nội bộ và phản hồi nhân viên. Không tự động tăng lương hoặc kết luận lương hiện tại thấp.',
 'monthly_salary','ACTIVE'),
('RETENTION_CAREER_DEVELOPMENT','Trao đổi lộ trình phát triển nghề nghiệp',
 'HR trao đổi mục tiêu nghề nghiệp, tiêu chí phát triển và cơ hội đào tạo hoặc thăng tiến. Không tự động thay đổi chức danh hoặc cấp bậc.',
 'promotions','ACTIVE')
ON CONFLICT(code) DO NOTHING;
COMMIT;
