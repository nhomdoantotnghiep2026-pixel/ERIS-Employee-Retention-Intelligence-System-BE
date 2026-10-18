const jwt = require('jsonwebtoken');
const { AppError } = require('../errors/app-error');
const { env } = require('../../config/env');
const { TOKEN_PURPOSE } = require('../../modules/auth/auth.constants');

function authenticate(request, _response, next) {
  const authorization = request.get('authorization');
  const [scheme, token] = authorization ? authorization.split(' ') : [];

  if (scheme !== 'Bearer' || !token) {
    return next(new AppError(401, 'A valid access token is required.'));
  }

  try {
    const payload = jwt.verify(token, env.auth.jwtSecret);

    if (payload.type !== TOKEN_PURPOSE.ACCESS || !payload.sub) {
      throw new AppError(401, 'A valid access token is required.');
    }

    request.auth = {
      userId: Number(payload.sub),
      roleId: payload.roleId,
      status: payload.status
    };

    return next();
  } catch (error) {
    if (error instanceof AppError) return next(error);
    return next(new AppError(401, 'A valid access token is required.'));
  }
}

module.exports = { authenticate };
