const departmentsPaths = {
  '/api/departments/listDepartments': {
    get: {
      tags: ['Departments'],
      summary: 'Lấy danh sách phòng ban (HR)',
      security: [{ bearerAuth: [] }],
      responses: {
        200: {
          description: 'Danh sách phòng ban.',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  data: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        id: { type: 'integer', example: 1 },
                        code: { type: 'string', example: 'HR' },
                        name: { type: 'string', example: 'Human Resources' },
                        description: { type: 'string', nullable: true },
                        status: { type: 'string', example: 'ACTIVE' }
                      }
                    }
                  }
                }
              }
            }
          }
        },
        401: { description: 'Thiếu hoặc sai access token.' },
        403: { description: 'Chỉ tài khoản HR được phép truy cập.' }
      }
    }
  },
  '/api/departments/createDepartments': {
    post: {
      tags: ['Departments'],
      summary: 'Tạo phòng ban (HR)',
      security: [{ bearerAuth: [] }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['name'],
              properties: {
                name: { type: 'string', example: 'Information Technology' },
                description: { type: 'string', example: 'Phòng công nghệ thông tin' }
              }
            }
          }
        }
      },
      responses: {
        201: { description: 'Tạo phòng ban thành công; code được tự sinh theo DP + ID.' },
        400: { description: 'Dữ liệu đầu vào không hợp lệ.' },
        401: { description: 'Thiếu hoặc sai access token.' },
        403: { description: 'Chỉ tài khoản HR được phép truy cập.' }
      }
    }
  },
  '/api/departments/deleteDepartments/{id}': {
    delete: {
      tags: ['Departments'],
      summary: 'Ngừng hoạt động phòng ban (HR)',
      security: [{ bearerAuth: [] }],
      parameters: [{
        name: 'id',
        in: 'path',
        required: true,
        schema: { type: 'integer', minimum: 1 }
      }],
      responses: {
        200: { description: 'Phòng ban đã được chuyển sang INACTIVE.' },
        400: { description: 'ID không hợp lệ.' },
        401: { description: 'Thiếu hoặc sai access token.' },
        403: { description: 'Chỉ tài khoản HR được phép truy cập.' },
        404: { description: 'Không tìm thấy phòng ban.' },
        409: { description: 'Phòng ban đã INACTIVE hoặc vẫn còn employee ACTIVE.' }
      }
    }
  },
  '/api/departments/updateDepartments/{id}': {
    patch: {
      tags: ['Departments'],
      summary: 'Cập nhật tên hoặc mô tả phòng ban (HR)',
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
                name: { type: 'string', example: 'Information Technology' },
                description: { type: 'string', nullable: true, example: 'Phụ trách hệ thống và hạ tầng công nghệ' }
              }
            }
          }
        }
      },
      responses: {
        200: { description: 'Cập nhật phòng ban thành công.' },
        400: { description: 'ID hoặc dữ liệu cập nhật không hợp lệ.' },
        401: { description: 'Thiếu hoặc sai access token.' },
        403: { description: 'Chỉ tài khoản HR được phép truy cập.' },
        404: { description: 'Không tìm thấy phòng ban.' }
      }
    }
  }
};

module.exports = { departmentsPaths };
