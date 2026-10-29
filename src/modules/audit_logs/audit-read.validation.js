const { AppError } = require('../../common/errors/app-error');
function validateAuditLogId(value) {
  if (typeof value !== 'string' || !/^[1-9]\d{0,9}$/.test(value) || Number(value) > 2147483647) {
    throw new AppError(400, 'ID audit log phải là số nguyên dương, tối đa 2147483647.');
  }
  return Number(value);
}
module.exports = { validateAuditLogId };
