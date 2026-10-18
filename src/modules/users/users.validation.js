const { AppError } = require('../../common/errors/app-error');
const { UPDATABLE_HR_STATUS } = require('./users.constants');

function validateUserId(value) {
  const userId = Number(value);

  if (!Number.isSafeInteger(userId) || userId <= 0) {
    throw new AppError(400, 'User id must be a positive integer.');
  }

  return userId;
}

function validateUpdateUserStatusInput(body) {
  const status = typeof body?.status === 'string' ? body.status.trim().toUpperCase() : '';

  if (!Object.values(UPDATABLE_HR_STATUS).includes(status)) {
    throw new AppError(400, 'Status must be ACTIVE or INACTIVE.');
  }

  return { status };
}

module.exports = { validateUserId, validateUpdateUserStatusInput };
