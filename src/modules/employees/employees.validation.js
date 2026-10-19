const { AppError } = require('../../common/errors/app-error');

function validatePositiveInteger(value, fieldName) {
  const parsedValue = Number(value);

  if (!Number.isInteger(parsedValue) || parsedValue <= 0) {
    throw new AppError(400, `${fieldName} must be a positive integer.`);
  }

  return parsedValue;
}

function validateDate(value, fieldName, { required = false, mustBePast = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new AppError(400, `${fieldName} is required.`);
    return null;
  }

  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new AppError(400, `${fieldName} must use YYYY-MM-DD format.`);
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new AppError(400, `${fieldName} must be a valid date.`);
  }

  if (mustBePast && date >= new Date()) {
    throw new AppError(400, `${fieldName} must be in the past.`);
  }

  return value;
}

function validateOptionalString(value, fieldName, maxLength) {
  if (value === undefined || value === null) return null;

  if (typeof value !== 'string' || value.trim().length > maxLength) {
    throw new AppError(400, `${fieldName} must be a string of at most ${maxLength} characters.`);
  }

  return value.trim() || null;
}

function validateOptionalNonNegativeNumber(value, fieldName) {
  if (value === undefined || value === null) return null;

  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new AppError(400, `${fieldName} must be a non-negative number.`);
  }

  return value;
}

function validateOptionalText(value, fieldName) {
  if (value === undefined || value === null) return null;

  if (typeof value !== 'string') {
    throw new AppError(400, `${fieldName} must be a string.`);
  }

  return value.trim() || null;
}

function validateCreateEmployeeInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new AppError(400, 'Request body must be an object.');
  }

  const allowedFields = new Set([
    'fullName',
    'email',
    'phone',
    'dateOfBirth',
    'gender',
    'address',
    'distanceFromHomeKm',
    'departmentId',
    'positionId',
    'hireDate',
    'employmentType',
    'currentSalary'
  ]);

  if (Object.keys(input).some((field) => !allowedFields.has(field))) {
    throw new AppError(400, 'Request body contains unsupported fields.');
  }

  if (typeof input.fullName !== 'string' || !input.fullName.trim() || input.fullName.trim().length > 150) {
    throw new AppError(400, 'fullName is required and must be at most 150 characters.');
  }

  const email = validateOptionalString(input.email, 'email', 255);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new AppError(400, 'email must be valid.');
  }

  return {
    fullName: input.fullName.trim(),
    email: email?.toLowerCase() || null,
    phone: validateOptionalString(input.phone, 'phone', 30),
    dateOfBirth: validateDate(input.dateOfBirth, 'dateOfBirth', { mustBePast: true }),
    gender: validateOptionalString(input.gender, 'gender', 20),
    address: input.address === undefined || input.address === null
      ? null
      : typeof input.address === 'string'
        ? input.address.trim() || null
        : (() => { throw new AppError(400, 'address must be a string.'); })(),
    distanceFromHomeKm: validateOptionalNonNegativeNumber(input.distanceFromHomeKm, 'distanceFromHomeKm'),
    departmentId: validatePositiveInteger(input.departmentId, 'departmentId'),
    positionId: validatePositiveInteger(input.positionId, 'positionId'),
    hireDate: validateDate(input.hireDate, 'hireDate', { required: true }),
    employmentType: validateOptionalString(input.employmentType, 'employmentType', 40),
    currentSalary: validateOptionalNonNegativeNumber(input.currentSalary, 'currentSalary')
  };
}

function validateUpdateEmployeeInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new AppError(400, 'Request body must be an object.');
  }

  const allowedFields = new Set([
    'fullName',
    'email',
    'phone',
    'dateOfBirth',
    'gender',
    'address',
    'distanceFromHomeKm',
    'departmentId',
    'positionId',
    'hireDate',
    'employmentType',
    'currentSalary'
  ]);
  const suppliedFields = Object.keys(input);

  if (!suppliedFields.length) {
    throw new AppError(400, 'Provide at least one employee field to update.');
  }

  if (suppliedFields.some((field) => !allowedFields.has(field))) {
    throw new AppError(400, 'Request body contains unsupported fields.');
  }

  const employee = {};

  if (Object.hasOwn(input, 'fullName')) {
    if (typeof input.fullName !== 'string' || !input.fullName.trim() || input.fullName.trim().length > 150) {
      throw new AppError(400, 'fullName must be a non-empty string of at most 150 characters.');
    }
    employee.fullName = input.fullName.trim();
  }

  if (Object.hasOwn(input, 'email')) {
    const email = validateOptionalString(input.email, 'email', 255);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new AppError(400, 'email must be valid.');
    }
    employee.email = email?.toLowerCase() || null;
  }

  if (Object.hasOwn(input, 'phone')) employee.phone = validateOptionalString(input.phone, 'phone', 30);
  if (Object.hasOwn(input, 'dateOfBirth')) employee.dateOfBirth = validateDate(input.dateOfBirth, 'dateOfBirth', { mustBePast: true });
  if (Object.hasOwn(input, 'gender')) employee.gender = validateOptionalString(input.gender, 'gender', 20);
  if (Object.hasOwn(input, 'address')) employee.address = validateOptionalText(input.address, 'address');
  if (Object.hasOwn(input, 'distanceFromHomeKm')) employee.distanceFromHomeKm = validateOptionalNonNegativeNumber(input.distanceFromHomeKm, 'distanceFromHomeKm');
  if (Object.hasOwn(input, 'departmentId')) employee.departmentId = validatePositiveInteger(input.departmentId, 'departmentId');
  if (Object.hasOwn(input, 'positionId')) employee.positionId = validatePositiveInteger(input.positionId, 'positionId');
  if (Object.hasOwn(input, 'hireDate')) employee.hireDate = validateDate(input.hireDate, 'hireDate', { required: true });
  if (Object.hasOwn(input, 'employmentType')) employee.employmentType = validateOptionalString(input.employmentType, 'employmentType', 40);
  if (Object.hasOwn(input, 'currentSalary')) employee.currentSalary = validateOptionalNonNegativeNumber(input.currentSalary, 'currentSalary');

  return employee;
}

function validateEmployeeId(value) {
  return validatePositiveInteger(value, 'Employee id');
}

module.exports = { validateCreateEmployeeInput, validateUpdateEmployeeInput, validateEmployeeId };
