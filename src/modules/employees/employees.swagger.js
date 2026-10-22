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
              required: ['fullName', 'email', 'departmentId', 'positionId', 'hireDate'],
              properties: {
                fullName: { type: 'string', example: 'Nguyễn Văn A' },
                email: { type: 'string', format: 'email', example: 'nguyenvana@eris.com' },
                phone: { type: 'string', example: '0901234567' },
                dateOfBirth: { type: 'string', format: 'date', example: '2000-01-15' },
                gender: { type: 'string', example: 'MALE' },
                address: { type: 'string', example: '68 Út Tịch, Phường 4, Quận Tân Bình, Thành phố Hồ Chí Minh' },                departmentId: { type: 'integer', minimum: 1, example: 1 },
                positionId: { type: 'integer', minimum: 1, example: 2 },
                hireDate: { type: 'string', format: 'date', example: '2026-10-19' },
                employmentType: { type: 'string', example: 'FULL_TIME' },
                currentSalary: { type: 'number', minimum: 0, exclusiveMinimum: true, description: 'Lương phải lớn hơn 0 nếu có nhập.', example: 18000000 }
              }
            }
          }
        }
      },
      responses: {
        201: { description: 'Tạo nhân viên thành công; employeeCode được tự sinh theo EMP + ID.' },
        400: { description: 'Dữ liệu đầu vào không hợp lệ.' },
        401: { description: 'Thiếu hoặc sai token truy cập.' },
        403: { description: 'Chỉ tài khoản HR được phép truy cập.' },
        404: { description: 'Không tìm thấy phòng ban hoặc vị trí công việc đang hoạt động (ACTIVE).' },
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
                address: { type: 'string', nullable: true },                departmentId: { type: 'integer', minimum: 1 },
                positionId: { type: 'integer', minimum: 1 },
                hireDate: { type: 'string', format: 'date' },
                employmentType: { type: 'string', nullable: true },
                currentSalary: { type: 'number', minimum: 0, exclusiveMinimum: true, description: 'Lương phải lớn hơn 0 nếu có nhập.', nullable: true }
              }
            }
          }
        }
      },
      responses: {
        200: { description: 'Cập nhật nhân viên thành công.' },
        400: { description: 'ID hoặc dữ liệu cập nhật không hợp lệ.' },
        401: { description: 'Thiếu hoặc sai token truy cập.' },
        403: { description: 'Chỉ tài khoản HR được phép truy cập.' },
        404: { description: 'Không tìm thấy nhân viên hoặc phòng ban/vị trí công việc đang hoạt động (ACTIVE).' },
        409: { description: 'Email đã được nhân viên khác sử dụng hoặc không được phép đổi email đăng nhập đã liên kết.' }
      }
    }
  }
};

employeesPaths['/api/employees'].get = {
  tags: ['Employees'], summary: 'Xem tất cả nhân viên và thông tin hồ sơ (HR)',
  security: [{ bearerAuth: [] }],
  description: 'Trả tất cả nhân viên cùng thông tin hồ sơ. Không cần nhập tham số.',
  responses: { 200: { description: 'Trả danh sách trong data và thông tin phân trang trong pagination: page (trang hiện tại), limit (số bản ghi mỗi trang), total (tổng số bản ghi), totalPages (tổng số trang).' }, 400: { description: 'Tham số tìm kiếm, lọc hoặc phân trang không hợp lệ.' }, 401: { description: 'Thiếu hoặc sai token truy cập.' }, 403: { description: 'Chỉ tài khoản HR được phép truy cập.' } }
};
employeesPaths['/api/employees/{id}'].get = {
  tags: ['Employees'], summary: 'Xem chi tiết nhân viên (HR)', security: [{ bearerAuth: [] }],
  parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer', minimum: 1 } }],
  responses: { 200: { description: 'Trả trực tiếp hồ sơ nhân viên, gồm distanceFromHomeKm và distanceCalculation; không bọc trong data.' }, 400: { description: 'ID nhân viên phải là số nguyên dương.' }, 401: { description: 'Thiếu hoặc sai token truy cập.' }, 403: { description: 'Chỉ tài khoản HR được phép truy cập.' }, 404: { description: 'Không tìm thấy nhân viên.' } }
};
for (const [route, method] of [['/api/employees','post'], ['/api/employees/{id}','patch']]) {
  employeesPaths[route][method].description = 'Hệ thống tự xác định tọa độ và tính quãng đường ô tô bằng Vietmap Route v4 trước khi lưu. Không gửi distanceFromHomeKm trong dữ liệu đầu vào. Kết quả trong data gồm distanceFromHomeKm (đơn vị km) và distanceCalculation: READY (đã tính được), UNAVAILABLE (chưa tính được, xem reason) hoặc NOT_PROVIDED (chưa nhập địa chỉ). Không cần bước xem trước hoặc xác nhận thủ công. Nếu chưa tính được khoảng cách, trả 422 và không lưu hồ sơ/tài khoản.';
}
employeesPaths['/api/employees'].post.description += ' Đồng thời tạo tài khoản EMPLOYEE liên kết với hồ sơ, có trạng thái IN_PROCESS; hồ sơ và tài khoản được lưu trong cùng giao dịch. Email là bắt buộc. Mật khẩu ban đầu được gửi qua email. Khi đăng nhập lần đầu, hệ thống gửi OTP qua email và trả passwordChangeToken để thiết lập mật khẩu riêng. Kết quả có account (thông tin tài khoản) và emailDelivery (SENT: gửi thành công; FAILED: gửi thất bại). Không trả mật khẩu hoặc mã hash. Nếu gửi email thất bại, tài khoản đã được lưu, không tạo lại.';
employeesPaths['/api/employees'].post.responses[503] = { description: 'Chưa cấu hình role EMPLOYEE, mật khẩu ban đầu hoặc dịch vụ gửi email.' };
employeesPaths['/api/employees/{id}'].patch.description += ' Chỉ tính lại khoảng cách khi gửi trường address. Không được gửi null hoặc chuỗi rỗng. Đổi địa chỉ mà không tính được distance sẽ trả 422 và giữ dữ liệu cũ; sửa trường khác giữ nguyên khoảng cách. Không được đổi email đăng nhập đã liên kết qua API này (trả 409).';
const employeePatch = employeesPaths['/api/employees/{id}'].patch;
for (const field of ['employeeCode', 'email', 'dateOfBirth', 'hireDate']) {
  delete employeePatch.requestBody.content['application/json'].schema.properties[field];
}
employeePatch.description = employeePatch.description.replace('Không được đổi email đăng nhập đã liên kết qua API này (trả 409).', 'Không được cập nhật employeeCode, email, dateOfBirth hoặc hireDate; gửi bất kỳ trường nào trong số này sẽ trả 400, kể cả giá trị cũ hoặc null.');
employeePatch.responses[409] = { description: 'Không được cập nhật nhân viên có employmentStatus là INACTIVE hoặc có xung đột dữ liệu.' };
employeesPaths['/api/employees/{id}'].delete = {
  tags: ['Employees'], summary: 'Xóa mềm nhân viên (HR)',
  description: 'Chuyển employmentStatus của hồ sơ sang INACTIVE và khóa tài khoản liên kết (status: INACTIVE) trong cùng giao dịch. Không xóa bản ghi hoặc giải phóng email/mã nhân viên. Tài khoản không thể đăng nhập, làm mới token hoặc hoàn tất kích hoạt. Danh sách và chi tiết vẫn giữ hồ sơ; dùng employmentStatus để lọc. Không cần gửi body.',
  security: [{ bearerAuth: [] }],
  parameters: [{ name: 'id', in: 'path', required: true, description: 'ID nhân viên cần xóa mềm.', schema: { type: 'integer', minimum: 1 } }],
  responses: {
    200: { description: 'Xóa mềm thành công; trả message và data gồm id, employeeCode, employmentStatus, updatedAt.' },
    400: { description: 'ID phải là số nguyên dương.' },
    401: { description: 'Thiếu hoặc sai token truy cập.' },
    403: { description: 'Chỉ HR được phép thực hiện.' },
    404: { description: 'Không tìm thấy nhân viên.' },
    409: { description: 'Nhân viên đã ở trạng thái INACTIVE.' }
  }
};
employeesPaths['/api/employees/import'] = {
  post: {
    tags: ['Employees'], summary: 'Import Excel tạo hồ sơ và tài khoản nhân viên (HR)',
    description: 'Upload một file .xlsx, tối đa 5 MB và 200 dòng, chỉ một sheet có dữ liệu. Dòng đầu là tên cột giống JSON tạo thủ công. Bắt buộc đủ 11 cột và giá trị: fullName, email, phone, dateOfBirth, gender, address, departmentId, positionId, hireDate, employmentType, currentSalary. Không gửi employeeCode, distanceFromHomeKm. Ngày nhập dạng YYYY-MM-DD hoặc ô ngày Excel; phone phải là Text để giữ số 0 đầu. Không dùng công thức/hyperlink. Dùng chung validation và luồng tạo thủ công: kiểm tra trùng email, phòng ban/vị trí ACTIVE, lương > 0; chỉ lưu khi tính được distance; nếu không, dòng đó FAILED và không tạo hồ sơ/tài khoản. Tự tính distance, tạo tài khoản IN_PROCESS và gửi email. Xử lý tối đa 3 dòng đồng thời và giữ thứ tự kết quả theo file; dòng lỗi không hủy dòng thành công. Các địa chỉ giống hệt nhau dùng chung kết quả distance trong một lần import. Response có total, created, failed và results theo số dòng Excel. CREATED với emailDelivery FAILED vẫn đã lưu, không import lại dòng đó. Request xử lý đồng bộ và có thể mất vài phút với file lớn; giữ kết nối đến khi có kết quả.',
    security: [{ bearerAuth: [] }],
    requestBody: { required: true, content: { 'multipart/form-data': { schema: { type: 'object', required: ['file'], properties: { file: { type: 'string', format: 'binary' } } } } } },
    responses: {
      200: { description: 'Kết quả từng dòng; kiểm tra created/failed và results, không chỉ HTTP 200.' },
      400: { description: 'Thiếu file, file/header không hợp lệ, quá 200 dòng hoặc nhiều sheet có dữ liệu.' },
      401: { description: 'Thiếu hoặc sai token.' }, 403: { description: 'Chỉ HR được import.' },
      413: { description: 'File vượt quá 5 MB.' }
    }
  }
};
employeesPaths['/api/employees'].post.responses[422] = { description: 'Không xác minh hoặc định tuyến được địa chỉ đã chọn; chưa tạo hồ sơ.' };
employeesPaths['/api/employees'].post.requestBody.content['application/json'].schema.required = ["fullName","email","phone","dateOfBirth","gender","address","departmentId","positionId","hireDate","employmentType","currentSalary"];
for (const operation of [employeesPaths['/api/employees'].post, employeesPaths['/api/employees/{id}'].patch]) {
  for (const property of Object.values(operation.requestBody.content['application/json'].schema.properties)) delete property.nullable;
  operation.responses[422] = { description: 'Không tính được distanceFromHomeKm: không lưu hồ sơ/tài khoản mới; cập nhật địa chỉ giữ nguyên dữ liệu cũ.' };
}
employeesPaths['/api/employees'].post.description += ' Bắt buộc đầy đủ 11 trường thông tin; không chấp nhận thiếu, null hoặc chuỗi rỗng. mã nhân viên và distance do server tạo.';
employeesPaths['/api/employees/{id}'].patch.description += ' HR chỉ được tự sửa phone và address; các trường khác phải nhờ HR khác sửa.';
employeesPaths['/api/employees/{id}'].delete.description = 'Xóa mềm hồ sơ và ngừng tài khoản liên kết. Không được tự xóa hồ sơ của mình.';
// One request schema for both employee account creation and existing HR profile linking.
employeesPaths['/api/employees'].post.description = 'Tạo hồ sơ với 11 trường bắt buộc. Kiểm tra email trùng trong employees (không phân biệt hoa/thường). Nếu users đã có tài khoản HR chưa có employeeId, liên kết hồ sơ mới vào tài khoản đó và đồng bộ full_name; giữ nguyên email, role, mật khẩu và trạng thái, không gửi lại mật khẩu. Nếu chưa có tài khoản, hệ thống tự tạo EMPLOYEE IN_PROCESS. Không được tự tạo hồ sơ HR của mình. Tài khoản INACTIVE hoặc tài khoản khác không phù hợp bị từ chối. Hệ thống tự sinh mã/ID và tính distance. Import áp dụng cùng logic cho từng dòng.';
employeesPaths['/api/employees'].post.responses[403] = { description: 'Sai quyền hoặc tự tạo hồ sơ cho mình.' };
employeesPaths['/api/employees'].post.responses[409] = { description: 'Email đã có hồ sơ hoặc tài khoản không đủ điều kiện liên kết.' };
const createSchema = employeesPaths['/api/employees'].post.requestBody.content['application/json'].schema;
createSchema.additionalProperties = false;
createSchema.required = ['fullName','email','phone','dateOfBirth','gender','address','departmentId','positionId','hireDate','employmentType','currentSalary'];
employeesPaths['/api/employees/import'].post.description += ' Email thuộc HR khác đang ACTIVE hoặc IN_PROCESS và chưa có hồ sơ sẽ liên kết hồ sơ với tài khoản HR đó; không tạo tài khoản mới hoặc gửi lại mật khẩu. Không được import hồ sơ của chính mình.';
module.exports = { employeesPaths };
