const { AppError } = require('../../common/errors/app-error');

function positiveId(value, field) {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value) ||
      !Number.isSafeInteger(Number(value)) || Number(value) > 2147483647) {
    throw new AppError(400, `${field} phải là số nguyên dương.`);
  }
  return Number(value);
}

module.exports = { positiveId };
