const { AppError } = require('../../common/errors/app-error');

function validateCreateDepartmentInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new AppError(400, 'Request body must be an object.');
  }

  const allowedFields = new Set(['name', 'description']);
  if (Object.keys(input).some((field) => !allowedFields.has(field))) {
    throw new AppError(400, 'Only name and description are allowed when creating a department.');
  }

  if (typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 150) {
    throw new AppError(400, 'name is required and must be at most 150 characters.');
  }

  if (input.description !== undefined && input.description !== null && typeof input.description !== 'string') {
    throw new AppError(400, 'description must be a string.');
  }

  return {
    name: input.name.trim(),
    description: input.description?.trim() || null
  };
}

function validateDepartmentId(value) {
  const id = Number(value);

  if (!Number.isInteger(id) || id <= 0) {
    throw new AppError(400, 'Department id must be a positive integer.');
  }

  return id;
}

function validateUpdateDepartmentInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new AppError(400, 'Request body must be an object.');
  }

  const allowedFields = new Set(['name', 'description']);
  const suppliedFields = Object.keys(input);

  if (!suppliedFields.length) {
    throw new AppError(400, 'Provide name or description to update.');
  }

  if (suppliedFields.some((field) => !allowedFields.has(field))) {
    throw new AppError(400, 'Only name and description can be updated.');
  }

  const department = {};

  if (Object.hasOwn(input, 'name')) {
    if (typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 150) {
      throw new AppError(400, 'name must be a non-empty string of at most 150 characters.');
    }
    department.name = input.name.trim();
  }

  if (Object.hasOwn(input, 'description')) {
    if (input.description !== null && typeof input.description !== 'string') {
      throw new AppError(400, 'description must be a string or null.');
    }
    department.description = input.description?.trim() || null;
  }

  return department;
}

module.exports = { validateCreateDepartmentInput, validateDepartmentId, validateUpdateDepartmentInput };
