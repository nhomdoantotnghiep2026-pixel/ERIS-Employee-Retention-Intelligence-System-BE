const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const { env } = require('../../config/env');
const { TOKEN_PURPOSE } = require('../../modules/auth/auth.constants');

function createAccessToken(user) {
  return jwt.sign({ roleId: user.roleId, status: user.status, type: TOKEN_PURPOSE.ACCESS }, env.auth.jwtSecret, {
    subject: String(user.id),
    expiresIn: env.auth.accessTokenTtlSeconds
  });
}

function createRefreshToken(user) {
  const sessionId = crypto.randomUUID();
  const token = jwt.sign({ sessionId, type: TOKEN_PURPOSE.REFRESH }, env.auth.jwtSecret, {
    subject: String(user.id),
    expiresIn: env.auth.refreshTokenTtlSeconds
  });

  return { token, sessionId };
}

function createPasswordChangeToken(user) {
  return jwt.sign({ type: TOKEN_PURPOSE.PASSWORD_CHANGE }, env.auth.jwtSecret, {
    subject: String(user.id),
    expiresIn: env.auth.passwordChangeTokenTtlSeconds
  });
}

function verifyRefreshToken(token) {
  const payload = jwt.verify(token, env.auth.jwtSecret);

  if (payload.type !== TOKEN_PURPOSE.REFRESH || !payload.sessionId || !payload.sub) {
    throw new Error('Invalid refresh token.');
  }

  return payload;
}

module.exports = { createAccessToken, createRefreshToken, createPasswordChangeToken, verifyRefreshToken };
