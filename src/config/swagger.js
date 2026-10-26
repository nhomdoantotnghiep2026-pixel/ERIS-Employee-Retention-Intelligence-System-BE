const { educationPaths } = require('../modules/employee-education/education.swagger');
const { attendancePaths } = require('../modules/attendance/attendance.swagger');
const swaggerJsdoc = require('swagger-jsdoc');
const { authPaths } = require('../modules/auth/auth.swagger');
const { departmentsPaths } = require('../modules/departments/departments.swagger');
const { employeesPaths } = require('../modules/employees/employees.swagger');
const { positionsPaths } = require('../modules/positions/positions.swagger');
const { distancePaths } = require('../modules/distance/distance.swagger');
const { usersPaths } = require('../modules/users/users.swagger');

const swaggerSpec = swaggerJsdoc({
  definition: {
    openapi: '3.0.3',
    info: { title: 'ERIS Backend API', version: '1.0.0', description: 'Employee Retention Intelligence System API documentation.' },
    servers: [{ url: 'http://localhost:3000', description: 'Local development server' }],
    tags: [{ name: 'Auth', description: 'Xác thực và quản lý phiên đăng nhập.' }],
    paths: { ...educationPaths, ...attendancePaths, ...authPaths, ...departmentsPaths, ...employeesPaths, ...positionsPaths, ...usersPaths, ...distancePaths },
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }
      },
      schemas: {
        LoginRequest: { type: 'object', required: ['email', 'password'], properties: { email: { type: 'string', format: 'email', example: 'admin@eris.com' }, password: { type: 'string', format: 'password', example: 'Password123!' } } },
        EmailRequest: { type: 'object', required: ['email'], properties: { email: { type: 'string', format: 'email', example: 'user@eris.com' } } },
        ChangePasswordRequest: { type: 'object', required: ['otp', 'newPassword'], properties: { currentPassword: { type: 'string', format: 'password', description: 'Bắt buộc khi dùng access token của user ACTIVE.' }, otp: { type: 'string', pattern: '^\\d{6}$', example: '123456' }, newPassword: { type: 'string', format: 'password', example: 'NewPassword123!' } } },
        ResetPasswordRequest: { type: 'object', required: ['email', 'otp', 'newPassword'], properties: { email: { type: 'string', format: 'email' }, otp: { type: 'string', pattern: '^\\d{6}$', example: '123456' }, newPassword: { type: 'string', format: 'password', example: 'NewPassword123!' } } },
        UserRegisterRequest: { type: 'object', additionalProperties: false, required: ['email'], properties: {
          email: { type: 'string', format: 'email', maxLength: 255, example: 'hr.new@example.com' },
          roleId: { type: 'integer', minimum: 1, example: 2, description: 'Tùy chọn; nếu gửi phải là ID của role HR trong database. Bỏ qua để tự dùng HR.' }
        } },
        User: { type: 'object', properties: { id: { type: 'integer', example: 3 }, email: { type: 'string', format: 'email', example: 'employee@eris.com' }, fullName: { type: 'string', example: 'Trần Văn A', nullable: true }, role: { type: 'string', example: 'EMPLOYEE' }, status: { type: 'string', enum: ['ACTIVE', 'IN_PROCESS'], example: 'ACTIVE' } } },
        AccessTokenResponse: { type: 'object', properties: { accessToken: { type: 'string', description: 'JWT access token.' } } },
LoginResponse: { oneOf: [{ $ref: '#/components/schemas/AccessTokenResponse' }, { type: 'object', properties: { message: { type: 'string' }, passwordChangeToken: { type: 'string' } } }] },
        Error: { type: 'object', properties: { message: { type: 'string' } } }
      },
      responses: {
        ValidationError: { description: 'Dữ liệu đầu vào không hợp lệ.', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        UnauthorizedError: { description: 'Thiếu hoặc không hợp lệ thông tin xác thực.', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } }
      }
    }
  },
  apis: []
});

module.exports = { swaggerSpec };