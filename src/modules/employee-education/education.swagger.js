const employeeParam = { name: 'employeeId', in: 'path', required: true, schema: { type: 'integer', minimum: 1 }, description: 'ID nhân viên.' };
const educationParam = { name: 'educationId', in: 'path', required: true, schema: { type: 'integer', minimum: 1 }, description: 'ID bằng cấp của nhân viên.' };
const properties = {
  educationLevel: { type: 'integer', enum: [1, 2, 3, 4], example: 2, description: '1 Cao đẳng, 2 Cử nhân, 3 Thạc sĩ, 4 Tiến sĩ.' },
  fieldOfStudy: { type: 'string', nullable: true, maxLength: 150, example: 'Công nghệ thông tin' },
  institution: { type: 'string', maxLength: 150, example: 'FPT University', description: 'Chỉ tên trường đúng như gợi ý đã chọn; địa chỉ Vietmap chỉ hiển thị để phân biệt cơ sở, không lưu vào institution.' },
  institutionRefId: { type: 'string', maxLength: 528, pattern: '^(https://ror[.]org/[a-z0-9]{9}|vietmap:(auto|geocode):[A-Za-z0-9_-]{1,512})$', description: 'ID từ gợi ý ROR hoặc Vietmap. Backend xác minh trước khi lưu.' },
  graduationYear: { type: 'integer', nullable: true, minimum: 1900, example: 2024, description: 'Từ năm sinh + 21 đến năm hiện tại.' }
};
const description = 'Chỉ HR ACTIVE. Khi tạo, cần educationLevel, institution và institutionRefId từ gợi ý ROR hoặc Vietmap. Không nhận tên trường nhập tay. Khi đổi trường, gửi cả institution và institutionRefId; khi chỉ sửa thông tin khác, bỏ cả hai. Backend xác minh bản ghi trong nguồn đã chọn; ROR yêu cầu active và loại education. Hồ sơ nhân viên phải ACTIVE; khi xem còn yêu cầu tài khoản liên kết ACTIVE. Năm tốt nghiệp phải từ năm sinh + 21 và không quá năm hiện tại. Nếu tên trường cho thấy bậc đào tạo có thể không khớp educationLevel, API trả warning để HR đối chiếu văn bằng; vẫn cho phép lưu.';
function operation(summary, { id = false, body = false, create = false } = {}) {
  return {
    tags: ['Employee Education'], summary, description, security: [{ bearerAuth: [] }],
    parameters: id ? [employeeParam, educationParam] : [employeeParam],
    ...(body ? { requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', additionalProperties: false, minProperties: 1, ...(create ? { required: ['educationLevel', 'institution', 'institutionRefId'] } : {}), properties } } } } } : {}),
    responses: {
      [create ? 201 : 200]: { description: 'Thành công; khi tạo/cập nhật trả thêm warning (chuỗi hoặc null). Cảnh báo chỉ dựa trên tên trường và không chặn lưu.' },
      400: { description: 'Dữ liệu không hợp lệ, trường chưa chọn từ gợi ý, hoặc tên trường không khớp ID nguồn.' },
      401: { description: 'Thiếu hoặc sai access token.' },
      403: { description: 'Chỉ HR ACTIVE.' },
      404: { description: 'Không tìm thấy nhân viên hoặc bằng cấp.' },
      409: { description: 'Trạng thái hồ sơ hoặc tài khoản không cho phép thao tác; hoặc thiếu ngày sinh để kiểm tra năm tốt nghiệp.' },
      503: { description: 'Nguồn trường học tạm không khả dụng; chưa lưu dữ liệu, hãy thử lại.' }
    }
  };
}
const educationPaths = {
  '/api/employees/me/educations': {
    get: {
      tags: ['Employee Education'],
      summary: 'Xem bằng cấp của chính mình',
      description: 'Tài khoản EMPLOYEE hoặc HR đang ACTIVE và có hồ sơ nhân viên ACTIVE chỉ xem được các bằng cấp ACTIVE của chính mình. Backend lấy employeeId từ tài khoản đăng nhập.',
      security: [{ bearerAuth: [] }],
      responses: {
        200: { description: 'data là danh sách bằng cấp đang ACTIVE của chính người đăng nhập.' },
        401: { description: 'Thiếu hoặc sai access token.' },
        403: { description: 'Tài khoản hoặc hồ sơ chưa ACTIVE.' }
      }
    }
  },
  '/api/employees/{employeeId}/educations': {
    post: operation('Thêm bằng cấp cho nhân viên (HR)', { body: true, create: true }),
    get: operation('Xem bằng cấp của nhân viên (HR)')
  },
  '/api/employees/{employeeId}/educations/{educationId}': {
    patch: operation('Cập nhật bằng cấp (HR)', { id: true, body: true }),
    delete: { ...operation('Xóa mềm bằng cấp nhập sai (HR)', { id: true }), description: `${description} Chuyển status của bằng cấp từ ACTIVE sang INACTIVE; bản ghi vẫn được lưu trong cơ sở dữ liệu và không còn xuất hiện trong danh sách.` }
  },
  '/api/employee-educations': {
    get: { tags: ['Employee Education'], summary: 'Xem tất cả bằng cấp nhân viên (HR)', description: 'Chỉ trả bằng cấp của nhân viên có hồ sơ ACTIVE và tài khoản liên kết ACTIVE; không lọc hoặc phân trang.', security: [{ bearerAuth: [] }], responses: { 200: { description: 'data là mảng bằng cấp, kèm employeeId, employeeCode và fullName.' }, 401: { description: 'Thiếu hoặc sai token.' }, 403: { description: 'Chỉ HR ACTIVE.' } } }
  },
  '/api/employee-educations/institutions': {
    get: { tags: ['Employee Education'], summary: 'Gợi ý trường từ ROR và Vietmap (HR)', description: 'Tìm toàn cầu trên ROR trước. Nếu ROR không có kết quả khớp tên, tìm trường tại Việt Nam qua Vietmap Search v4 (cần VIETMAP_API_KEY). Khi educationLevel=1 và tên tìm ngắn chưa có bậc, Vietmap tìm thêm với từ “cao đẳng”. Mỗi lần tối đa 10 gợi ý. Chỉ lưu trường đã chọn và xác minh lại ở nguồn tương ứng. Đây không phải dịch vụ xác minh văn bằng.', security: [{ bearerAuth: [] }], parameters: [{ name: 'name', in: 'query', required: true, schema: { type: 'string', minLength: 2, maxLength: 100 }, example: 'FPT' }, { name: 'educationLevel', in: 'query', required: false, schema: { type: 'integer', enum: [1, 2, 3, 4] }, description: 'Ưu tiên tên trường có vẻ phù hợp với bậc đã chọn; tên không khớp vẫn có thể hiện với cảnh báo.' }], responses: { 200: { description: 'data gồm id, institution (chỉ tên trường), address/display (để phân biệt cơ sở Vietmap), country, source (ROR/VIETMAP), levelFit (MATCH/UNKNOWN/MISMATCH), levelWarning khi gửi educationLevel; manualEntryAllowed false.' }, 400: { description: 'Từ khóa hoặc tham số không hợp lệ.' }, 401: { description: 'Thiếu hoặc sai token.' }, 403: { description: 'Chỉ HR ACTIVE.' }, 503: { description: 'Nguồn trường học tạm không khả dụng; thử lại sau.' } } }
  },
  '/api/employee-educations/employees': {
    get: { tags: ['Employee Education'], summary: 'Nhân viên đủ điều kiện xem bằng cấp (HR)', description: 'Chỉ trả nhân viên có hồ sơ ACTIVE và tài khoản liên kết ACTIVE.', security: [{ bearerAuth: [] }], responses: { 200: { description: 'data gồm id, employeeCode, fullName, dateOfBirth và employmentStatus.' }, 401: { description: 'Thiếu hoặc sai token.' }, 403: { description: 'Chỉ HR ACTIVE.' } } }
  }
};
for (const [path, method] of [
  ['/api/employees/{employeeId}/educations', 'post'],
  ['/api/employees/{employeeId}/educations/{educationId}', 'patch'],
  ['/api/employees/{employeeId}/educations/{educationId}', 'delete']
]) {
  const api = educationPaths[path][method];
  api.description += ' HR không được tự thay đổi bằng cấp của mình; một HR khác phải thực hiện.';
  api.responses[403] = { description: 'Chỉ HR ACTIVE; không được tự thay đổi bằng cấp của mình.' };
}
module.exports = { educationPaths };
