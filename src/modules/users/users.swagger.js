const usersPaths = {
  '/api/users/{id}/status': {
    patch: {
      tags: ['Users'],
      summary: 'ADMIN cập nhật trạng thái account HR',
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
              required: ['status'],
              properties: {
                status: { type: 'string', enum: ['ACTIVE', 'INACTIVE'] }
              }
            }
          }
        }
      },
      responses: {
        200: { description: 'Cập nhật trạng thái thành công.' },
        400: { description: 'ID hoặc status không hợp lệ.' },
        401: { description: 'Thiếu hoặc sai access token.' },
        403: { description: 'Không phải ADMIN hoặc target không phải HR.' },
        404: { description: 'Không tìm thấy user.' }
      }
    }
  }
};

const accountSchema = {
  type: 'object', properties: {
    id: { type: 'integer' }, email: { type: 'string', format: 'email' }, fullName: { type: 'string', nullable: true },
    role: { type: 'object', properties: { id: { type: 'integer', nullable: true }, name: { type: 'string', nullable: true, example: 'HR' } } },
    status: { type: 'string', example: 'ACTIVE' }, employeeId: { type: 'integer', nullable: true },
    createdAt: { type: 'string', format: 'date-time' }, updatedAt: { type: 'string', format: 'date-time' }
  }
};
const readErrors = {
  401: { description: 'Thiếu, hết hạn hoặc sai access token.' },
  403: { description: 'Không đủ quyền hoặc tài khoản không ACTIVE. Quyền được kiểm tra lại trong database.' }
};
usersPaths['/api/users'] = { get: {
  tags: ['Users'], summary: 'Admin xem tất cả tài khoản', security: [{ bearerAuth: [] }],
  description: 'Chỉ ADMIN ACTIVE. Trả toàn bộ tài khoản ADMIN, HR, EMPLOYEE, gồm mọi trạng thái, sắp xếp ID tăng dần. Không có bộ lọc hoặc phân trang. Không trả password_hash, OTP hoặc token.',
  responses: { ...readErrors,
    200: { description: 'data là mảng thông tin tài khoản.', content: { 'application/json': { schema: {
      type: 'object', properties: { data: { type: 'array', items: accountSchema } }
    } } } } }
} };
usersPaths['/api/users/{id}'] = { get: {
  tags: ['Users'], summary: 'Xem chi tiết tài khoản: ADMIN xem tất cả, role khác chỉ xem bản thân', security: [{ bearerAuth: [] }],
  description: 'Tài khoản gọi phải ACTIVE. ADMIN xem bất kỳ user nào; HR và EMPLOYEE chỉ xem khi ID trên URL bằng ID user đang đăng nhập. Dùng ID tài khoản, không phải employeeId. role trả object {id,name} theo dữ liệu thật. Không cần employeeId để xem tài khoản bản thân.',
  parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer', minimum: 1, maximum: 2147483647 } }],
  responses: { ...readErrors,
    200: { description: 'data chứa thông tin tài khoản.', content: { 'application/json': { schema: { type: 'object', properties: { data: accountSchema } } } } },
    400: { description: 'ID tài khoản không hợp lệ.' }, 404: { description: 'Không tìm thấy tài khoản.' }
  }
} };
module.exports = { usersPaths };
