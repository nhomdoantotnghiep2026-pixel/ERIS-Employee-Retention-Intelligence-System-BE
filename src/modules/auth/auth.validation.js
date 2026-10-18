const AUTH_REQUEST_FIELDS = Object.freeze({
  LOGIN: ['email', 'password'],
  USER_REGISTER: ['email', 'roleId', 'employeeId'],
  CHANGE_PASSWORD: ['currentPassword', 'otp', 'newPassword'],
  FORGOT_PASSWORD: ['email'],
  RESET_PASSWORD: ['email', 'otp', 'newPassword']
});

module.exports = { AUTH_REQUEST_FIELDS };
