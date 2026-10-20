const { env } = require('../../config/env');
const { REFRESH_COOKIE_NAME } = require('./auth.constants');
const {
  validateRegisterHrInput,
  validateChangePasswordInput,
  validateEmailInput,
  validateLoginInput,
  validateResetPasswordInput
} = require('./auth.validation');

function getCookieValue(cookieHeader, cookieName) {
  if (!cookieHeader) return undefined;

  const cookie = cookieHeader.split(';').map((value) => value.trim())
    .find((value) => value.startsWith(`${cookieName}=`));
  if (!cookie) return undefined;

  try {
    return decodeURIComponent(cookie.slice(cookieName.length + 1));
  } catch {
    return undefined;
  }
}

function refreshCookieOptions() {
  return {
    httpOnly: true,
    secure: env.auth.cookieSecure,
    sameSite: env.auth.cookieSameSite,
    path: '/api/auth'
  };
}

class AuthController {
  constructor(authService) {
    this.authService = authService;
    this.login = this.login.bind(this);
    this.registerHr = this.registerHr.bind(this);
    this.me = this.me.bind(this);
    this.refresh = this.refresh.bind(this);
    this.logout = this.logout.bind(this);
    this.changePassword = this.changePassword.bind(this);
    this.requestChangePasswordOtp = this.requestChangePasswordOtp.bind(this);
    this.forgotPassword = this.forgotPassword.bind(this);
    this.resetPassword = this.resetPassword.bind(this);
  }

  async registerHr(request, response, next) {
    try {
      const input = validateRegisterHrInput(request.body);
      const data = await this.authService.registerHr({ actorId: request.auth.userId, input });
      return response.status(201).json({ message: 'HR account created successfully.', data });
    } catch (error) { return next(error); }
  }

  async login(request, response, next) {
    try {
      const loginInput = validateLoginInput(request.body);
      const result = await this.authService.login(loginInput);

      if (result.kind === 'ACTIVE') {
        response.cookie(REFRESH_COOKIE_NAME, result.refreshToken, {
          ...refreshCookieOptions(),
          maxAge: env.auth.refreshTokenTtlSeconds * 1000
        });

        return response.status(200).json({
          message: 'Login successful.',
          accessToken: result.accessToken,
          user: result.user
        });
      }

      return response.status(200).json({
        message: result.message,
        passwordChangeToken: result.passwordChangeToken
      });
    } catch (error) {
      return next(error);
    }
  }

  async me(request, response, next) {
    try {
      const user = await this.authService.getCurrentUser(request.auth.userId);
      return response.status(200).json(user);
    } catch (error) {
      return next(error);
    }
  }

  async refresh(request, response, next) {
    try {
      const refreshToken = getCookieValue(request.headers.cookie, REFRESH_COOKIE_NAME);
      const result = await this.authService.refresh(refreshToken);

      response.cookie(REFRESH_COOKIE_NAME, result.refreshToken, {
        ...refreshCookieOptions(),
        maxAge: env.auth.refreshTokenTtlSeconds * 1000
      });
      return response.status(200).json({ accessToken: result.accessToken });
    } catch (error) {
      return next(error);
    }
  }

  async logout(request, response, next) {
    try {
      const refreshToken = getCookieValue(request.headers.cookie, REFRESH_COOKIE_NAME);
      await this.authService.logout(refreshToken);
      response.clearCookie(REFRESH_COOKIE_NAME, refreshCookieOptions());
      return response.status(200).json({ message: 'Logout successful.' });
    } catch (error) {
      return next(error);
    }
  }

  async changePassword(request, response, next) {
    try {
      const input = validateChangePasswordInput(request.body);
      const result = await this.authService.changePassword({ ...request.auth, ...input });
      response.clearCookie(REFRESH_COOKIE_NAME, refreshCookieOptions());
      return response.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  }

  async requestChangePasswordOtp(request, response, next) {
    try {
      const result = await this.authService.requestChangePasswordOtp(request.auth.userId);
      return response.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  }

  async forgotPassword(request, response, next) {
    try {
      const { email } = validateEmailInput(request.body);
      const result = await this.authService.forgotPassword(email);
      return response.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  }

  async resetPassword(request, response, next) {
    try {
      const input = validateResetPasswordInput(request.body);
      const result = await this.authService.resetPassword(input);
      response.clearCookie(REFRESH_COOKIE_NAME, refreshCookieOptions());
      return response.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  }
}

module.exports = { AuthController };
