const { AppError } = require('../../common/errors/app-error');
const { normalizeEmail } = require('../../common/validation/email');

function validateLoginInput(body) {
  const email = normalizeEmail(body?.email);
  const password = typeof body?.password === 'string' ? body.password : '';

  if (!email || password.length === 0) {
    throw new AppError(400, 'Email and password are required.');
  }

  return { email, password };
}

function validateChangePasswordInput(body) {
  const currentPassword = typeof body?.currentPassword === 'string' ? body.currentPassword : undefined;
  const otp = typeof body?.otp === 'string' ? body.otp.trim() : '';
  const newPassword = typeof body?.newPassword === 'string' ? body.newPassword : '';

  if (!/^\d{6}$/.test(otp)) {
    throw new AppError(400, 'OTP must contain exactly 6 digits.');
  }

  if (newPassword.length < 8) {
    throw new AppError(400, 'New password must contain at least 8 characters.');
  }

  return { currentPassword, otp, newPassword };
}

function validateEmailInput(body) {
  const email = normalizeEmail(body?.email);

  if (!email) {
    throw new AppError(400, 'A valid email is required.');
  }

  return { email };
}

function validateResetPasswordInput(body) {
  const { otp, newPassword } = validateChangePasswordInput(body);
  const { email } = validateEmailInput(body);
  return { email, otp, newPassword };
}

function validateRegisterHrInput(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new AppError(400, 'Request body must be an object.');
  if (Object.keys(body).some(key => !['email', 'full_name', 'hireDate', 'roleId'].includes(key))) {
    throw new AppError(400, 'Only email, full_name, hireDate and optional roleId are allowed. This endpoint creates HR accounts only.');
  }
  const email = normalizeEmail(body.email);
  if (!email) throw new AppError(400, 'A valid email is required.');
  if (typeof body.full_name !== 'string' || !body.full_name.trim() || [...body.full_name.trim()].length > 150) {
    throw new AppError(400, 'full_name is required and must be a non-empty string of at most 150 characters.');
  }
  if (typeof body.hireDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.hireDate)
    || !Number.isFinite(Date.parse(`${body.hireDate}T00:00:00Z`))
    || new Date(`${body.hireDate}T00:00:00Z`).toISOString().slice(0, 10) !== body.hireDate) {
    throw new AppError(400, 'hireDate is required and must be a valid YYYY-MM-DD date.');
  }
  if (body.roleId !== undefined && (!Number.isSafeInteger(body.roleId) || body.roleId <= 0)) throw new AppError(400, 'roleId must be a positive integer identifying HR.');
  return { email, fullName: body.full_name.trim(), hireDate: body.hireDate, ...(body.roleId !== undefined ? { roleId: body.roleId } : {}) };
}

module.exports = {
  validateRegisterHrInput,
  validateLoginInput,
  validateChangePasswordInput,
  validateEmailInput,
  validateResetPasswordInput
};
