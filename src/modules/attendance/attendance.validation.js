const { AppError } = require('../../common/errors/app-error');
function validateAttendanceId(value) {
  if (typeof value !== 'string' || !/^[1-9]\d{0,18}$/.test(value) || BigInt(value) > 9223372036854775807n) {
    throw new AppError(400, 'id must be a positive integer.');
  }
  return value;
}
module.exports = { validateAttendanceId };
