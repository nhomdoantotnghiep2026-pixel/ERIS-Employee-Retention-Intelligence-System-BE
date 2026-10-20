const { AppError } = require('../../common/errors/app-error');

function validateLoginInput(body) {
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body?.password === 'string' ? body.password : '';

  if (!/^\S+@\S+\.\S+$/.test(email) || password.length === 0) {
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
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';

  if (!/^\S+@\S+\.\S+$/.test(email)) {
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
  if (Object.keys(body).some(key => !['email', 'roleId'].includes(key))) {
    throw new AppError(400, 'Only email and optional roleId are allowed. This endpoint creates HR accounts only.');
  }
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (email.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AppError(400, 'A valid email is required.');
  if (body.roleId !== undefined && (!Number.isSafeInteger(body.roleId) || body.roleId <= 0)) throw new AppError(400, 'roleId must be a positive integer identifying HR.');
  return { email, ...(body.roleId !== undefined ? { roleId: body.roleId } : {}) };
}

module.exports = {
  validateRegisterHrInput,
  validateLoginInput,
  validateChangePasswordInput,
  validateEmailInput,
  validateResetPasswordInput
};
