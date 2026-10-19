const employeesPaths = {
  '/api/employees': {
    post: {
      tags: ['Employees'],
      summary: 'Tạo nhân viên (HR)',
      security: [{ bearerAuth: [] }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['fullName', 'departmentId', 'positionId', 'hireDate'],
              properties: {
                fullName: { type: 'string', example: 'Nguyễn Văn A' },
                email: { type: 'string', format: 'email', example: 'nguyenvana@eris.com' },
                phone: { type: 'string', example: '0901234567' },
                dateOfBirth: { type: 'string', format: 'date', example: '2000-01-15' },
                gender: { type: 'string', example: 'MALE' },
                address: { type: 'string', example: 'TP. Hồ Chí Minh' },
                distanceFromHomeKm: { type: 'number', minimum: 0, example: 12.5 },
                departmentId: { type: 'integer', minimum: 1, example: 1 },
                positionId: { type: 'integer', minimum: 1, example: 2 },
                hireDate: { type: 'string', format: 'date', example: '2026-10-19' },
                employmentType: { type: 'string', example: 'FULL_TIME' },
                currentSalary: { type: 'number', minimum: 0, example: 18000000 }
              }
            }
          }
        }
      },
      responses: {
        201: { description: 'Tạo nhân viên thành công; employeeCode được tự sinh theo EMP + ID.' },
        400: { description: 'Dữ liệu đầu vào không hợp lệ.' },
        401: { description: 'Thiếu hoặc sai access token.' },
        403: { description: 'Chỉ tài khoản HR được phép truy cập.' },
        404: { description: 'Không tìm thấy department hoặc position đang ACTIVE.' },
        409: { description: 'Email đã tồn tại.' }
      }
    }
  },
  '/api/employees/{id}': {
    patch: {
      tags: ['Employees'],
      summary: 'Cập nhật nhân viên (HR)',
      security: [{ bearerAuth: [] }],
      parameters: [{
        name: 'id',
        in: 'path',
        required: true,
        schema: { type: 'integer', minimum: 1 }
      }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              minProperties: 1,
              properties: {
                fullName: { type: 'string', example: 'Nguyễn Văn A' },
                email: { type: 'string', format: 'email', nullable: true },
                phone: { type: 'string', nullable: true },
                dateOfBirth: { type: 'string', format: 'date', nullable: true },
                gender: { type: 'string', nullable: true },
                address: { type: 'string', nullable: true },
                distanceFromHomeKm: { type: 'number', minimum: 0, nullable: true },
                departmentId: { type: 'integer', minimum: 1 },
                positionId: { type: 'integer', minimum: 1 },
                hireDate: { type: 'string', format: 'date' },
                employmentType: { type: 'string', nullable: true },
                currentSalary: { type: 'number', minimum: 0, nullable: true }
              }
            }
          }
        }
      },
      responses: {
        200: { description: 'Cập nhật nhân viên thành công.' },
        400: { description: 'ID hoặc dữ liệu cập nhật không hợp lệ.' },
        401: { description: 'Thiếu hoặc sai access token.' },
        403: { description: 'Chỉ tài khoản HR được phép truy cập.' },
        404: { description: 'Không tìm thấy employee, department hoặc position đang ACTIVE.' },
        409: { description: 'Email đã được employee khác sử dụng.' }
      }
    }
  }
};

module.exports = { employeesPaths };
