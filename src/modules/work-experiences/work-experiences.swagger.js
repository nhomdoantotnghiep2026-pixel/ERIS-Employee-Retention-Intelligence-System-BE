const employeeParam = { name: 'employeeId', in: 'path', required: true, schema: { type: 'integer', minimum: 1 } };
const experienceParam = { name: 'experienceId', in: 'path', required: true, schema: { type: 'integer', minimum: 1 } };
const responses = {
  200: { description: 'Thành công. data chứa các bản ghi kinh nghiệm làm việc.' },
  400: { description: 'ID phải là số nguyên dương.' },
  401: { description: 'Thiếu hoặc sai access token.' },
  403: { description: 'Chỉ HR ACTIVE; HR không được tự thêm hoặc xóa kinh nghiệm của mình.' },
  404: { description: 'Không tìm thấy nhân viên hoặc kinh nghiệm đang ACTIVE thuộc nhân viên này.' },
  409: { description: 'Hồ sơ nhân viên chưa ACTIVE; khi xem còn yêu cầu tài khoản liên kết ACTIVE.' }
};
const operation = (summary, parameters = []) => ({ tags: ['Employee Work Experiences'], summary, security: [{ bearerAuth: [] }], parameters, responses });
const workExperiencesPaths = {
  '/api/employee-work-experiences': {
    get: { ...operation('Xem tất cả kinh nghiệm làm việc (HR)'), description: 'Trả các kinh nghiệm ACTIVE của nhân viên có hồ sơ và tài khoản ACTIVE, kèm employeeId, employeeCode, fullName. Không có bộ lọc hoặc phân trang.' }
  },
  '/api/employees/{employeeId}/work-experiences': {
    post: {
      ...operation('Thêm kinh nghiệm làm việc cho nhân viên (HR)', [employeeParam]),
      description: 'Dùng cùng validation khi tạo hồ sơ. Hồ sơ phải ACTIVE; HR không được tự thêm kinh nghiệm của mình. Ngày chỉ có tháng/năm được chuyển thành ngày 01; không nhận ngày tương lai, ngày bắt đầu trước hoặc bằng ngày sinh, ngày kết thúc trước ngày bắt đầu. Bản ghi mới có status ACTIVE.',
      requestBody: { required: true, content: { 'application/json': { schema: {
        type: 'object', additionalProperties: false, required: ['companyName', 'positionTitle', 'startDate'],
        properties: {
          companyName: { type: 'string', maxLength: 150, example: 'Công ty ABC' },
          positionTitle: { type: 'string', maxLength: 150, example: 'Backend Developer' },
          startDate: { type: 'string', description: 'YYYY-MM-DD, YYYY-MM hoặc MM/YYYY', example: '2021-06' },
          endDate: { type: 'string', nullable: true, description: 'Không bắt buộc; cùng định dạng startDate.', example: '2024-05' }
        }
      } } } },
      responses: { ...Object.fromEntries(Object.entries(responses).filter(([code]) => code !== '200')), 201: { description: 'Đã thêm kinh nghiệm. data chứa bản ghi vừa lưu.' }, 400: { description: 'ID hoặc thông tin kinh nghiệm không hợp lệ.' } }
    },
    get: { ...operation('Xem kinh nghiệm làm việc của một nhân viên (HR)', [employeeParam]), description: 'Trả employee và data là danh sách kinh nghiệm ACTIVE, sắp xếp theo ngày bắt đầu mới nhất. Nhân viên chưa có kinh nghiệm trả data: []. Ngày trả dạng YYYY-MM-DD.' }
  },
  '/api/employees/{employeeId}/work-experiences/{experienceId}': {
    delete: { ...operation('Xóa mềm một kinh nghiệm làm việc (HR)', [employeeParam, experienceParam]), description: 'Chuyển status sang INACTIVE và cập nhật updated_at. Không xóa dòng khỏi database. HR khác phải xóa kinh nghiệm của chính HR; bản ghi đã xóa hoặc không thuộc nhân viên trả 404.' }
  }
};
module.exports = { workExperiencesPaths };
