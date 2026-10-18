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

module.exports = {
  validateLoginInput,
  validateChangePasswordInput,
  validateEmailInput,
  validateResetPasswordInput
};
