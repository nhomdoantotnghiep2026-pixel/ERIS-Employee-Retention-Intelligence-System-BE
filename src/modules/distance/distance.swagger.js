const distancePaths = {
  '/api/distance/places': { get: { tags: ['Distance'], summary: 'Gợi ý địa chỉ khi nhập (HR)', security: [{ bearerAuth: [] }],
    parameters: [{ name: 'query', in: 'query', required: true, schema: { type: 'string', minLength: 3, maxLength: 300 } }],
    responses: { 200: { description: 'Tối đa 5 gợi ý: refId, display, resolvedAddress và tọa độ.' }, 400: { description: 'Chuỗi tìm kiếm không hợp lệ.' }, 401: { description: 'Chưa đăng nhập.' }, 403: { description: 'Chỉ HR được tìm kiếm.' }, 503: { description: 'Dịch vụ địa chỉ chưa sẵn sàng.' } } }
} }; module.exports = { distancePaths };
