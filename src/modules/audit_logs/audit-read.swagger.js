const auditLog = {
  type: 'object', properties: {
    id: { type: 'integer' }, userId: { type: 'integer', nullable: true },
    actor: { type: 'object', nullable: true, properties: { id: { type: 'integer' }, email: { type: 'string' }, fullName: { type: 'string', nullable: true } } },
    entityType: { type: 'string', nullable: true, example: 'employees' }, entityId: { type: 'integer', nullable: true },
    action: { type: 'string', nullable: true, example: 'UPDATE' }, createdAt: { type: 'string', format: 'date-time' }
  }
};
const errors = {
  401: { description: 'Thiếu, hết hạn hoặc sai access token.' },
  403: { description: 'Chỉ ADMIN có tài khoản ACTIVE được xem log. Kiểm tra quyền hiện tại trong database.' }
};
const auditReadPaths = {
  '/api/audit-logs': { get: {
    tags: ['Audit Logs'], summary: 'Admin xem danh sách audit log', security: [{ bearerAuth: [] }],
    description: 'Trả toàn bộ log, mới nhất trước theo createdAt và id. Không có bộ lọc/phân trang. Danh sách gồm người thực hiện, đối tượng, hành động và thời điểm; dữ liệu trước/sau xem qua API chi tiết. Giữ log nếu tài khoản người thực hiện đã bị xóa (actor/userId có thể null).',
    responses: { ...errors, 200: { description: 'data là mảng, chưa có log trả [].', content: { 'application/json': { schema: { type: 'object', properties: { data: { type: 'array', items: auditLog } } } } } } }
  } },
  '/api/audit-logs/{id}': { get: {
    tags: ['Audit Logs'], summary: 'Admin xem chi tiết audit log', security: [{ bearerAuth: [] }],
    description: 'Có thêm oldValue/newValue từ JSONB trong bảng audit_logs. CREATE có oldValue=null. Các trường có tên chứa password/hash mật khẩu, token, secret, API key, OTP, cookie hoặc authorization được ẩn trong JSON trước/sau. Không chỉnh sửa bản ghi gốc.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer', minimum: 1, maximum: 2147483647 } }],
    responses: { ...errors,
      200: { description: 'data chứa một audit log.', content: { 'application/json': { schema: { type: 'object', properties: { data: {
        ...auditLog, properties: { ...auditLog.properties, oldValue: { type: 'object', nullable: true, additionalProperties: true }, newValue: { type: 'object', nullable: true, additionalProperties: true } }
      } } } } } },
      400: { description: 'ID không hợp lệ.' }, 404: { description: 'Không tìm thấy audit log.' }
    }
  } }
};
module.exports = { auditReadPaths };
