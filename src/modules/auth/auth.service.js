const { AppError } = require('../../common/errors/app-error');
const { generateOtp, hashOtp, isOtpValid } = require('../../common/utils/otp');
const { hashPassword, verifyPassword } = require('../../common/utils/password');
const {
  createAccessToken,
  createPasswordChangeToken,
  createRefreshToken,
  verifyRefreshToken
} = require('../../common/utils/token');
const { env } = require('../../config/env');
const { OTP_PURPOSE, USER_STATUS } = require('./auth.constants');

class AuthService {
  constructor({ authRepository, mailTransporter, redisClient, ensureRedisConnection }) {
    this.authRepository = authRepository;
    this.mailTransporter = mailTransporter;
    this.redisClient = redisClient;
    this.ensureRedisConnection = ensureRedisConnection;
  }

  async login({ email, password }) {
    const user = await this.authRepository.findUserByEmail(email);
    const isPasswordValid = user && await verifyPassword(password, user.password);

    if (!isPasswordValid) {
      throw new AppError(401, 'Invalid email or password.');
    }

    if (user.status === USER_STATUS.ACTIVE) {
      return this.createActiveLoginResponse(user);
    }

    if (user.status === USER_STATUS.IN_PROCESS) {
      return this.createInProcessLoginResponse(user);
    }

    throw new AppError(403, 'This user is not allowed to sign in.');
  }

  async getCurrentUser(userId) {
    const user = await this.authRepository.findCurrentUserById(userId);

    if (!user || user.status !== USER_STATUS.ACTIVE) {
      throw new AppError(401, 'A valid access token is required.');
    }

    return user;
  }

  async refresh(refreshToken) {
    const refreshPayload = this.getRefreshPayload(refreshToken);
    const userId = Number(refreshPayload.sub);
    const refreshSessionKey = `auth:refresh:${refreshPayload.sessionId}`;

    await this.ensureRedisConnection();
    const storedUserId = await this.redisClient.get(refreshSessionKey);

    if (storedUserId !== String(userId)) {
      throw new AppError(401, 'Refresh token is invalid or expired.');
    }

    const user = await this.authRepository.findUserForTokenById(userId);
    if (!user || user.status !== USER_STATUS.ACTIVE) {
      throw new AppError(401, 'Refresh token is invalid or expired.');
    }

    const { token: nextRefreshToken, sessionId: nextSessionId } = createRefreshToken(user);
    const userSessionsKey = `auth:refresh:user:${user.id}`;
    await this.redisClient.multi()
      .del(refreshSessionKey)
      .srem(userSessionsKey, refreshPayload.sessionId)
      .set(`auth:refresh:${nextSessionId}`, String(user.id), 'EX', env.auth.refreshTokenTtlSeconds)
      .sadd(userSessionsKey, nextSessionId)
      .expire(userSessionsKey, env.auth.refreshTokenTtlSeconds)
      .exec();

    return { accessToken: createAccessToken(user), refreshToken: nextRefreshToken };
  }

  async logout(refreshToken) {
    if (!refreshToken) return;

    let refreshPayload;
    try {
      refreshPayload = this.getRefreshPayload(refreshToken);
    } catch {
      return;
    }

    const userId = Number(refreshPayload.sub);
    const refreshSessionKey = `auth:refresh:${refreshPayload.sessionId}`;
    await this.ensureRedisConnection();

    if (await this.redisClient.get(refreshSessionKey) !== String(userId)) return;

    await this.redisClient.multi()
      .del(refreshSessionKey)
      .srem(`auth:refresh:user:${userId}`, refreshPayload.sessionId)
      .exec();
  }

  async changePassword({ userId, tokenType, currentPassword, otp, newPassword }) {
    const user = await this.authRepository.findUserCredentialsById(userId);

    if (!user) {
      throw new AppError(401, 'A valid authorization token is required.');
    }

    if (tokenType === 'ACCESS') {
      if (user.status !== USER_STATUS.ACTIVE || !currentPassword) {
        throw new AppError(400, 'Current password is required.');
      }

      const isCurrentPasswordValid = await verifyPassword(currentPassword, user.password);
      if (!isCurrentPasswordValid) {
        throw new AppError(401, 'Current password is incorrect.');
      }
    } else if (tokenType === 'PASSWORD_CHANGE') {
      if (user.status !== USER_STATUS.IN_PROCESS) {
        throw new AppError(401, 'A valid authorization token is required.');
      }
    } else {
      throw new AppError(401, 'A valid authorization token is required.');
    }

    await this.verifyChangePasswordOtp(user.id, otp);
    await this.authRepository.updatePassword(user.id, await hashPassword(newPassword), USER_STATUS.ACTIVE);
    await this.revokeRefreshSessions(user.id);

    return { message: 'Password changed successfully. Please sign in again.' };
  }

  async requestChangePasswordOtp(userId) {
    const user = await this.authRepository.findUserById(userId);

    if (!user || user.status !== USER_STATUS.ACTIVE) {
      throw new AppError(403, 'This user is not allowed to change password.');
    }

    await this.issueOtp({
      user,
      purpose: OTP_PURPOSE.CHANGE_PASSWORD,
      ttlSeconds: env.auth.passwordChangeTokenTtlSeconds,
      subject: 'ERIS change password OTP'
    });

    return { message: 'OTP has been sent to your email.' };
  }

  async forgotPassword(email) {
    const user = await this.authRepository.findUserByEmail(email);

    if (user?.status === USER_STATUS.ACTIVE) {
      try {
        await this.issueOtp({
          user,
          purpose: OTP_PURPOSE.RESET_PASSWORD,
          ttlSeconds: env.auth.passwordResetOtpTtlSeconds,
          subject: 'ERIS reset password OTP'
        });
      } catch (error) {
        console.error(`Unable to send password reset OTP: ${error.message}`);
      }
    }

    return { message: 'If the email exists, an OTP has been sent.' };
  }

  async resetPassword({ email, otp, newPassword }) {
    const user = await this.authRepository.findUserByEmail(email);

    if (!user || user.status !== USER_STATUS.ACTIVE) {
      throw new AppError(400, 'OTP is invalid or expired.');
    }

    await this.verifyOtp(user.id, OTP_PURPOSE.RESET_PASSWORD, otp);
    await this.authRepository.updatePassword(user.id, await hashPassword(newPassword), USER_STATUS.ACTIVE);
    await this.revokeRefreshSessions(user.id);

    return { message: 'Password reset successfully. Please sign in again.' };
  }

  async createActiveLoginResponse(user) {
    const { token: refreshToken, sessionId } = createRefreshToken(user);
    await this.ensureRedisConnection();
    const userSessionsKey = `auth:refresh:user:${user.id}`;
    await this.redisClient.multi()
      .set(`auth:refresh:${sessionId}`, String(user.id), 'EX', env.auth.refreshTokenTtlSeconds)
      .sadd(userSessionsKey, sessionId)
      .expire(userSessionsKey, env.auth.refreshTokenTtlSeconds)
      .exec();

    return {
      kind: 'ACTIVE',
      accessToken: createAccessToken(user),
      refreshToken,
      user: this.toUserResponse(user)
    };
  }

  async createInProcessLoginResponse(user) {
    await this.issueOtp({
      user,
      purpose: OTP_PURPOSE.CHANGE_PASSWORD,
      ttlSeconds: env.auth.passwordChangeTokenTtlSeconds,
      subject: 'ERIS password setup OTP'
    });

    return {
      kind: 'IN_PROCESS',
      passwordChangeToken: createPasswordChangeToken(user),
      message: 'Password setup is required. An OTP has been sent to your email.'
    };
  }

  toUserResponse(user) {
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      roleId: user.roleId,
      status: user.status
    };
  }

  async issueOtp({ user, purpose, ttlSeconds, subject }) {
    const otp = generateOtp();
    const otpKey = `auth:otp:${purpose}:${user.id}`;
    await this.ensureRedisConnection();
    await this.redisClient.set(
      otpKey,
      JSON.stringify({ hash: hashOtp(otp), attempts: 0 }),
      'EX',
      ttlSeconds
    );

    try {
      await this.mailTransporter.sendMail({
        from: env.mail.from,
        to: user.email,
        subject,
        text: `Your ERIS OTP is ${otp}. It expires in ${ttlSeconds} seconds.`
      });
    } catch (error) {
      await this.redisClient.del(otpKey);
      throw error;
    }
  }

  async verifyChangePasswordOtp(userId, otp) {
    return this.verifyOtp(userId, OTP_PURPOSE.CHANGE_PASSWORD, otp);
  }

  async verifyOtp(userId, purpose, otp) {
    const otpKey = `auth:otp:${purpose}:${userId}`;
    await this.ensureRedisConnection();
    const rawOtpRecord = await this.redisClient.get(otpKey);

    if (!rawOtpRecord) {
      throw new AppError(400, 'OTP is invalid or expired.');
    }

    let otpRecord;
    try {
      otpRecord = JSON.parse(rawOtpRecord);
    } catch {
      otpRecord = { hash: rawOtpRecord, attempts: 0 };
    }

    if (!isOtpValid(otp, otpRecord.hash)) {
      const attempts = Number(otpRecord.attempts || 0) + 1;

      if (attempts >= env.auth.otpMaxAttempts) {
        await this.redisClient.del(otpKey);
      } else {
        await this.redisClient.set(otpKey, JSON.stringify({ ...otpRecord, attempts }), 'KEEPTTL');
      }

      throw new AppError(400, 'OTP is invalid or expired.');
    }

    await this.redisClient.del(otpKey);
  }

  async revokeRefreshSessions(userId) {
    await this.ensureRedisConnection();
    const userSessionsKey = `auth:refresh:user:${userId}`;
    const sessionIds = await this.redisClient.smembers(userSessionsKey);
    const transaction = this.redisClient.multi();

    sessionIds.forEach((sessionId) => transaction.del(`auth:refresh:${sessionId}`));
    transaction.del(userSessionsKey);
    await transaction.exec();
  }

  getRefreshPayload(refreshToken) {
    try {
      return verifyRefreshToken(refreshToken);
    } catch {
      throw new AppError(401, 'Refresh token is invalid or expired.');
    }
  }
}

module.exports = { AuthService };
