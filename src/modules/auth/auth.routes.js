const express = require('express');
const { authenticate } = require('../../common/middleware/authenticate');
const { authenticatePasswordChange } = require('../../common/middleware/authenticate-password-change');

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

function createAuthRouter(authController) {
  const router = express.Router();

  router.post(AUTH_ROUTES.LOGIN, authController.login);
  router.get(AUTH_ROUTES.ME, authenticate, authController.me);
  router.post(AUTH_ROUTES.REFRESH, authController.refresh);
  router.post(AUTH_ROUTES.LOGOUT, authController.logout);
  router.post(AUTH_ROUTES.CHANGE_PASSWORD_OTP, authenticate, authController.requestChangePasswordOtp);
  router.patch(AUTH_ROUTES.CHANGE_PASSWORD, authenticatePasswordChange, authController.changePassword);
  router.post(AUTH_ROUTES.FORGOT_PASSWORD, authController.forgotPassword);
  router.post(AUTH_ROUTES.RESET_PASSWORD, authController.resetPassword);

  router.use((request, response) => {
    response.status(501).json({
      message: `Auth endpoint ${request.method} ${request.originalUrl} has not been implemented yet.`
    });
  });

  return router;
}

module.exports = { AUTH_ROUTES, createAuthRouter };
