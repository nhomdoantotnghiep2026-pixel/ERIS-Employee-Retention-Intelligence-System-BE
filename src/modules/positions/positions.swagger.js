const positionsPaths = {
  '/api/positions': {
    post: {
      tags: ['Positions'],
      summary: 'Tạo vị trí công việc (HR)',
      security: [{ bearerAuth: [] }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['name', 'jobLevel'],
              properties: {
                name: { type: 'string', example: 'Backend Developer' },
                jobLevel: {
                  type: 'integer',
                  minimum: 1,
                  maximum: 5,
                  example: 2,
                  description: '1 = Entry, 2 = Junior, 3 = Intermediate, 4 = Senior, 5 = Expert / Leadership.'
                },
                description: { type: 'string', nullable: true, example: 'Phát triển và vận hành backend' }
              }
            }
          }
        }
      },
      responses: {
        201: { description: 'Tạo vị trí công việc thành công; code được tự sinh theo POS + ID.' },
        400: { description: 'Dữ liệu đầu vào không hợp lệ.' },
        401: { description: 'Thiếu hoặc sai access token.' },
        403: { description: 'Chỉ tài khoản HR được phép truy cập.' }
      }
    },
    get: {
      tags: ['Positions'],
      summary: 'Lấy danh sách vị trí công việc (HR)',
      security: [{ bearerAuth: [] }],
      responses: {
        200: {
          description: 'Danh sách vị trí công việc.',
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
                        code: { type: 'string', example: 'DEV' },
                        name: { type: 'string', example: 'Software Developer' },
                        jobLevel: {
                          type: 'integer',
                          format: 'int32',
                          minimum: 1,
                          maximum: 5,
                          example: 2,
                          description: '1 = Entry, 2 = Junior, 3 = Intermediate, 4 = Senior, 5 = Expert / Leadership.'
                        },
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
  '/api/positions/{id}': {
    get: {
      tags: ['Positions'],
      summary: 'Lấy chi tiết vị trí công việc (HR)',
      security: [{ bearerAuth: [] }],
      parameters: [{
        name: 'id',
        in: 'path',
        required: true,
        schema: { type: 'integer', minimum: 1 }
      }],
      responses: {
        200: { description: 'Thông tin vị trí công việc.' },
        400: { description: 'ID không hợp lệ.' },
        401: { description: 'Thiếu hoặc sai access token.' },
        403: { description: 'Chỉ tài khoản HR được phép truy cập.' },
        404: { description: 'Không tìm thấy vị trí công việc.' }
      }
    },
    patch: {
      tags: ['Positions'],
      summary: 'Cập nhật vị trí công việc (HR)',
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
                name: { type: 'string', example: 'Senior Backend Developer' },
                jobLevel: {
                  type: 'integer',
                  minimum: 1,
                  maximum: 5,
                  example: 4,
                  description: '1 = Entry, 2 = Junior, 3 = Intermediate, 4 = Senior, 5 = Expert / Leadership.'
                },
                description: { type: 'string', nullable: true, example: 'Thiết kế và phát triển hệ thống backend' }
              }
            }
          }
        }
      },
      responses: {
        200: { description: 'Cập nhật vị trí công việc thành công.' },
        400: { description: 'ID hoặc dữ liệu cập nhật không hợp lệ.' },
        401: { description: 'Thiếu hoặc sai access token.' },
        403: { description: 'Chỉ tài khoản HR được phép truy cập.' },
        404: { description: 'Không tìm thấy vị trí công việc.' }
      }
    },
    delete: {
      tags: ['Positions'],
      summary: 'Ngừng hoạt động vị trí công việc (HR)',
      security: [{ bearerAuth: [] }],
      parameters: [{
        name: 'id',
        in: 'path',
        required: true,
        schema: { type: 'integer', minimum: 1 }
      }],
      responses: {
        200: { description: 'Vị trí công việc đã được chuyển sang INACTIVE.' },
        400: { description: 'ID không hợp lệ.' },
        401: { description: 'Thiếu hoặc sai access token.' },
        403: { description: 'Chỉ tài khoản HR được phép truy cập.' },
        404: { description: 'Không tìm thấy vị trí công việc.' },
        409: { description: 'Position đã INACTIVE hoặc vẫn còn employee ACTIVE.' }
      }
    }
  }
};

positionsPaths['/api/positions'].get.parameters = [{ name: 'departmentId', in: 'query', required: false,
  schema: { type: 'integer', minimum: 1 }, description: 'Chỉ trả vị trí thuộc phòng ban này. Bỏ qua để xem tất cả.' }];
positionsPaths['/api/positions'].get.description = 'Danh sách có departmentId để liên kết với phòng ban; màn hình tạo nhân viên chỉ cho chọn vị trí ACTIVE của phòng ban đã chọn.';
positionsPaths['/api/positions'].get.responses[200].content['application/json'].schema.properties.data.items.properties.departmentId = { type: 'integer', nullable: true };
positionsPaths['/api/positions'].get.responses[400] = { description: 'departmentId hoặc tham số không hợp lệ.' };
module.exports = { positionsPaths };
