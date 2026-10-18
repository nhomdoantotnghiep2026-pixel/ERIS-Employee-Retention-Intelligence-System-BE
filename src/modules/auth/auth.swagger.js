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
      tags: ['Auth'], summary: 'ADMIN tạo user HR hoặc EMPLOYEE', security: [{ bearerAuth: [] }],
      requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/UserRegisterRequest' } } } },
      responses: { 201: { description: 'User được tạo.' }, 400: { $ref: '#/components/responses/ValidationError' }, 401: { $ref: '#/components/responses/UnauthorizedError' }, 403: { description: 'Chỉ ADMIN được phép.' } }
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
