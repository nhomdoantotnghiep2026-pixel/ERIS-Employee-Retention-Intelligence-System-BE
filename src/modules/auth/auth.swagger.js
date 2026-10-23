const authPaths = {
  '/api/auth/login': {
    post: {
      tags: ['Auth'], summary: 'Đăng nhập',
      requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/LoginRequest' } } } },
      responses: { 200: { description: 'ACTIVE nhận access token và refresh cookie; IN_PROCESS nhận passwordChangeToken.' }, 400: { $ref: '#/components/responses/ValidationError' }, 401: { $ref: '#/components/responses/UnauthorizedError' }, 429: { description: 'Thử đăng nhập quá nhiều lần.' } }
    }
  },
  '/api/auth/me': {
    get: {
      tags: ['Auth'], summary: 'Lấy thông tin user hiện tại', security: [{ bearerAuth: [] }],
      responses: { 200: { description: 'Thông tin user hiện tại.', content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } } }, 401: { $ref: '#/components/responses/UnauthorizedError' } }
    }
  },
  '/api/auth/refresh': {
    post: {
      tags: ['Auth'], summary: 'Cấp access token từ refresh cookie',
      responses: { 200: { description: 'Access token mới.' }, 401: { $ref: '#/components/responses/UnauthorizedError' } }
    }
  },
  '/api/auth/logout': {
    post: {
      tags: ['Auth'], summary: 'Đăng xuất và xóa refresh cookie',
      responses: { 200: { description: 'Đăng xuất thành công.' } }
    }
  },
  '/api/auth/user_register': {
    post: {
      tags: ['Auth'], summary: 'AUTH-05 — ADMIN tạo tài khoản HR', security: [{ bearerAuth: [] }],
      description: 'Chỉ ADMIN đang ACTIVE được tạo HR. ADMIN chỉ cần nhập email; không nhập fullName hoặc employeeId. Họ tên và liên kết hồ sơ được cập nhật khi HR khác tạo hồ sơ qua POST /api/employees. Email bắt buộc, không được trùng users hoặc employees, không phân biệt hoa/thường. Mật khẩu ban đầu lấy từ INITIAL_USER_PASSWORD và được hash trước khi lưu. Tài khoản mới IN_PROCESS, employeeId là null; không tạo ADMIN/EMPLOYEE ở endpoint này. Email hướng dẫn được gửi sau khi lưu. Nếu data.emailDelivery là FAILED, tài khoản vẫn đã được tạo: không gửi lại request tạo. Đăng nhập lần đầu sẽ gửi OTP và trả passwordChangeToken; xác minh OTP và đổi mật khẩu qua PATCH /api/auth/change-password để ACTIVE, rồi đăng nhập lại. Không trả mật khẩu/hash trong response.',
      requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/UserRegisterRequest' } } } },
      responses: { 201: { description: 'Trả message và data: id, email, fullName, roleId, role HR, status IN_PROCESS, employeeId null, createdAt, emailDelivery SENT/FAILED.' }, 400: { $ref: '#/components/responses/ValidationError' }, 401: { $ref: '#/components/responses/UnauthorizedError' }, 403: { description: 'Chỉ ADMIN đang ACTIVE được phép.' }, 409: { description: 'Email đã tồn tại trong users hoặc employees.' }, 503: { description: 'Thiếu role HR, mật khẩu ban đầu hoặc cấu hình gửi email.' } }
    }
  },
  '/api/auth/change-password/otp': {
    post: {
      tags: ['Auth'], summary: 'Gửi OTP đổi mật khẩu', security: [{ bearerAuth: [] }],
      responses: { 200: { description: 'OTP đã được gửi qua email.' }, 401: { $ref: '#/components/responses/UnauthorizedError' } }
    }
  },
  '/api/auth/change-password': {
    patch: {
      tags: ['Auth'], summary: 'Đổi mật khẩu với OTP', security: [{ bearerAuth: [] }],
      requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/ChangePasswordRequest' } } } },
      responses: { 200: { description: 'Mật khẩu đã được đổi.' }, 400: { $ref: '#/components/responses/ValidationError' }, 401: { $ref: '#/components/responses/UnauthorizedError' } }
    }
  },
  '/api/auth/forgot-password': {
    post: {
      tags: ['Auth'], summary: 'Gửi OTP reset mật khẩu',
      requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/EmailRequest' } } } },
      responses: { 200: { description: 'Luôn trả thông báo chung.' }, 400: { $ref: '#/components/responses/ValidationError' } }
    }
  },
  '/api/auth/reset-password': {
    post: {
      tags: ['Auth'], summary: 'Reset mật khẩu với OTP',
      requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/ResetPasswordRequest' } } } },
      responses: { 200: { description: 'Mật khẩu đã được reset.' }, 400: { $ref: '#/components/responses/ValidationError' } }
    }
  }
};

module.exports = { authPaths };
