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

module.exports = { usersPaths };
