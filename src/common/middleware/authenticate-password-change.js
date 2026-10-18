const jwt = require('jsonwebtoken');
const { AppError } = require('../errors/app-error');
const { env } = require('../../config/env');
const { TOKEN_PURPOSE } = require('../../modules/auth/auth.constants');

function authenticatePasswordChange(request, _response, next) {
  const authorization = request.get('authorization');
  const [scheme, token] = authorization ? authorization.split(' ') : [];

  if (scheme !== 'Bearer' || !token) {
    return next(new AppError(401, 'A valid authorization token is required.'));
  }

  try {
    const payload = jwt.verify(token, env.auth.jwtSecret);
    const allowedTokenTypes = [TOKEN_PURPOSE.ACCESS, TOKEN_PURPOSE.PASSWORD_CHANGE];

    if (!allowedTokenTypes.includes(payload.type) || !payload.sub) {
      throw new AppError(401, 'A valid authorization token is required.');
    }

    request.auth = { userId: Number(payload.sub), tokenType: payload.type };
    return next();
  } catch (error) {
    if (error instanceof AppError) return next(error);
    return next(new AppError(401, 'A valid authorization token is required.'));
  }
}

module.exports = { authenticatePasswordChange };
