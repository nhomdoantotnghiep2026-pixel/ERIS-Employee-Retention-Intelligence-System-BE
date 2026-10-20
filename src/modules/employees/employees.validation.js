const { AppError } = require('../../common/errors/app-error');
const requiredEmployeeFields = ["fullName","email","phone","dateOfBirth","gender","address","departmentId","positionId","hireDate","employmentType","currentSalary"];
function assertFilled(input, fields) {
  for (const field of fields) {
    const value = input[field];
    if (value === undefined || value === null || (typeof value === 'string' && !value.trim())) {
      throw new AppError(400, field + ' is required and cannot be empty.');
    }
  }
}

function validatePositiveInteger(value, fieldName) {
  const parsedValue = Number(value);

  if (!Number.isSafeInteger(parsedValue) || parsedValue <= 0) {
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

function validateOptionalPositiveNumber(value, fieldName) {
  if (value === undefined || value === null) return null;

  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new AppError(400, `${fieldName} must be a number greater than 0.`);
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

  assertFilled(input, requiredEmployeeFields);
  const allowedFields = new Set([
    'fullName',
    'email',
    'phone',
    'dateOfBirth',
    'gender',
    'address',
    'addressRefId',
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
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new AppError(400, 'email must be valid.');
  }

  if (input.addressRefId !== undefined && (typeof input.addressRefId !== 'string' || !input.addressRefId.trim() || input.addressRefId.length > 2000 || typeof input.address !== 'string' || !input.address.trim())) {
    throw new AppError(400, 'addressRefId requires an address and a valid reference of at most 2000 characters.');
  }
  return {
    ...(input.addressRefId ? { addressRefId: input.addressRefId.trim() } : {}),
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
    departmentId: validatePositiveInteger(input.departmentId, 'departmentId'),
    positionId: validatePositiveInteger(input.positionId, 'positionId'),
    hireDate: validateDate(input.hireDate, 'hireDate', { required: true }),
    employmentType: validateOptionalString(input.employmentType, 'employmentType', 40),
    currentSalary: validateOptionalPositiveNumber(input.currentSalary, 'currentSalary')
  };
}

function validateUpdateEmployeeInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new AppError(400, 'Request body must be an object.');
  }

  assertFilled(input, Object.keys(input));
  const immutableFields = ['employeeCode', 'email', 'dateOfBirth', 'hireDate'];
  if (immutableFields.some(field => Object.hasOwn(input, field))) {
    throw new AppError(400, 'employeeCode, email, dateOfBirth and hireDate cannot be updated.');
  }
  const allowedFields = new Set([
    'fullName',
    'phone',
    'gender',
    'address',
    'addressRefId',
    'departmentId',
    'positionId',
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

  if (input.addressRefId !== undefined && (typeof input.addressRefId !== 'string' || !input.addressRefId.trim() || input.addressRefId.length > 2000 || typeof input.address !== 'string' || !input.address.trim())) {
    throw new AppError(400, 'addressRefId requires an address and a valid reference of at most 2000 characters.');
  }
  const employee = {};
  if (input.addressRefId !== undefined) employee.addressRefId = input.addressRefId.trim();

  if (Object.hasOwn(input, 'fullName')) {
    if (typeof input.fullName !== 'string' || !input.fullName.trim() || input.fullName.trim().length > 150) {
      throw new AppError(400, 'fullName must be a non-empty string of at most 150 characters.');
    }
    employee.fullName = input.fullName.trim();
  }


  if (Object.hasOwn(input, 'phone')) employee.phone = validateOptionalString(input.phone, 'phone', 30);
  if (Object.hasOwn(input, 'gender')) employee.gender = validateOptionalString(input.gender, 'gender', 20);
  if (Object.hasOwn(input, 'address')) employee.address = validateOptionalText(input.address, 'address');
  if (Object.hasOwn(input, 'departmentId')) employee.departmentId = validatePositiveInteger(input.departmentId, 'departmentId');
  if (Object.hasOwn(input, 'positionId')) employee.positionId = validatePositiveInteger(input.positionId, 'positionId');
  if (Object.hasOwn(input, 'employmentType')) employee.employmentType = validateOptionalString(input.employmentType, 'employmentType', 40);
  if (Object.hasOwn(input, 'currentSalary')) employee.currentSalary = validateOptionalPositiveNumber(input.currentSalary, 'currentSalary');

  return employee;
}

function validateEmployeeId(value) {
  return validatePositiveInteger(value, 'Employee id');
}

function validateListQuery(query) {
  const allowed = ['page', 'limit', 'q', 'search', 'departmentId', 'positionId', 'employmentStatus'];
  if (Object.keys(query).some(k => !allowed.includes(k)) || Object.values(query).some(v => typeof v !== 'string')) {
    throw new AppError(400, 'Unsupported or repeated query parameter.');
  }
  if (query.q !== undefined && query.search !== undefined) throw new AppError(400, 'Use q or search, not both.');
  const result = {};
  if (query.page !== undefined || query.limit !== undefined) {
    result.page = validatePositiveInteger(query.page ?? '1', 'page');
    result.limit = validatePositiveInteger(query.limit ?? '20', 'limit');
  }
  if (result.page !== undefined && (result.limit > 100 || !Number.isSafeInteger((result.page - 1) * result.limit))) throw new AppError(400, 'Invalid pagination; limit must not exceed 100.');
  result.search = (query.q ?? query.search ?? '').trim();
  if (result.search.length > 100) throw new AppError(400, 'Search must not exceed 100 characters.');
  for (const key of ['departmentId', 'positionId']) if (query[key] !== undefined) result[key] = validatePositiveInteger(query[key], key);
  if (query.employmentStatus !== undefined) {
    if (!query.employmentStatus.trim() || query.employmentStatus.length > 30) throw new AppError(400, 'Invalid employmentStatus.');
    result.employmentStatus = query.employmentStatus.trim();
  }
  return result;
}
module.exports = { validateCreateEmployeeInput, validateUpdateEmployeeInput, validateEmployeeId, validateListQuery, requiredEmployeeFields };
