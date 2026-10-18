const AUTH_ROUTES = Object.freeze({
  LOGIN: '/login',
  ME: '/me',
  REFRESH: '/refresh',
  LOGOUT: '/logout',
  USER_REGISTER: '/user_register',
  CHANGE_PASSWORD_OTP: '/change-password/otp',
  CHANGE_PASSWORD: '/change-password',
  FORGOT_PASSWORD: '/forgot-password',
  RESET_PASSWORD: '/reset-password'
});

module.exports = { AUTH_ROUTES };
