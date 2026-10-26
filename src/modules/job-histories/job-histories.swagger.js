const jobHistoriesPaths = {
  '/api/employees/me/job-histories': {
    get: {
      tags: ['Employee Job Histories'],
      summary: 'Xem lịch sử công việc của chính mình',
      description: 'Tài khoản EMPLOYEE hoặc HR đang ACTIVE và có hồ sơ nhân viên ACTIVE được xem lịch sử của chính mình. Backend lấy employeeId từ tài khoản đăng nhập; không nhận ID của người khác.',
      security: [{ bearerAuth: [] }],
      responses: {
        200: { description: 'data là các bản ghi lịch sử công việc của chính người đăng nhập.' },
        401: { description: 'Thiếu hoặc sai access token.' },
        403: { description: 'Tài khoản hoặc hồ sơ chưa ACTIVE.' },
        404: { description: 'Tài khoản chưa liên kết hồ sơ nhân viên.' }
      }
    }
  },
  '/api/job-histories': {
    get: {
      tags: ['Employee Job Histories'],
      summary: 'Xem tất cả bản ghi lịch sử công việc (HR)',
      description: 'Trả tất cả bản ghi, gồm mã và tên nhân viên, phòng ban, vị trí, jobLevel và các ngày bắt đầu/kết thúc. Sắp xếp theo startDate mới nhất rồi đến ID mới nhất. Bao gồm cả lịch sử của nhân viên đã ngừng hoạt động.',
      security: [{ bearerAuth: [] }],
      responses: {
        200: { description: 'Danh sách tất cả bản ghi lịch sử công việc.' },
        401: { description: 'Thiếu hoặc sai access token.' },
        403: { description: 'Chỉ HR ACTIVE được xem.' }
      }
    }
  },
  '/api/employees/{employeeId}/job-histories': {
    get: {
      tags: ['Employee Job Histories'],
      summary: 'Xem lịch sử công việc của một nhân viên (HR)',
      description: 'Lịch sử được tạo tự động khi HR tạo/import hồ sơ hoặc đổi phòng ban/vị trí qua PATCH /api/employees/{id}. Bản ghi hiện tại có endDate NULL.',
      security: [{ bearerAuth: [] }],
      parameters: [{ name: 'employeeId', in: 'path', required: true,
        schema: { type: 'integer', minimum: 1 }, description: 'ID nhân viên.' }],
      responses: {
        200: { description: 'Danh sách theo startDate mới nhất, gồm phòng ban, vị trí và jobLevel.' },
        400: { description: 'employeeId không hợp lệ.' },
        401: { description: 'Thiếu hoặc sai access token.' },
        403: { description: 'Chỉ HR ACTIVE.' },
        404: { description: 'Không tìm thấy nhân viên.' }
      }
    }
  }
};

module.exports = { jobHistoriesPaths };
