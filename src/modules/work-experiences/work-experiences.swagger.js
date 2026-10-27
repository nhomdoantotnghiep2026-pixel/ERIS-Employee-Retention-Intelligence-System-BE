const employeeParam = { name: 'employeeId', in: 'path', required: true, schema: { type: 'integer', minimum: 1 } };
const experienceParam = { name: 'experienceId', in: 'path', required: true, schema: { type: 'integer', minimum: 1 } };
const responses = {
  200: { description: 'Thành công. data chứa các bản ghi kinh nghiệm làm việc.' },
  400: { description: 'ID phải là số nguyên dương.' },
  401: { description: 'Thiếu hoặc sai access token.' },
  403: { description: 'Chỉ HR ACTIVE; HR không được tự xóa kinh nghiệm của mình.' },
  404: { description: 'Không tìm thấy nhân viên hoặc kinh nghiệm đang ACTIVE thuộc nhân viên này.' },
  409: { description: 'Hồ sơ nhân viên chưa ACTIVE; khi xem còn yêu cầu tài khoản liên kết ACTIVE.' }
};
const operation = (summary, parameters = []) => ({ tags: ['Employee Work Experiences'], summary, security: [{ bearerAuth: [] }], parameters, responses });
const workExperiencesPaths = {
  '/api/employee-work-experiences': {
    get: { ...operation('Xem tất cả kinh nghiệm làm việc (HR)'), description: 'Trả các kinh nghiệm ACTIVE của nhân viên có hồ sơ và tài khoản ACTIVE, kèm employeeId, employeeCode, fullName. Không có bộ lọc hoặc phân trang.' }
  },
  '/api/employees/{employeeId}/work-experiences': {
    get: { ...operation('Xem kinh nghiệm làm việc của một nhân viên (HR)', [employeeParam]), description: 'Trả employee và data là danh sách kinh nghiệm ACTIVE, sắp xếp theo ngày bắt đầu mới nhất. Nhân viên chưa có kinh nghiệm trả data: []. Ngày trả dạng YYYY-MM-DD.' }
  },
  '/api/employees/{employeeId}/work-experiences/{experienceId}': {
    delete: { ...operation('Xóa mềm một kinh nghiệm làm việc (HR)', [employeeParam, experienceParam]), description: 'Chuyển status sang INACTIVE và cập nhật updated_at. Không xóa dòng khỏi database. HR khác phải xóa kinh nghiệm của chính HR; bản ghi đã xóa hoặc không thuộc nhân viên trả 404.' }
  }
};
module.exports = { workExperiencesPaths };
