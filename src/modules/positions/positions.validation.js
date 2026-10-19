const { AppError } = require('../../common/errors/app-error');

function validatePositionId(value) {
  const id = Number(value);

  if (!Number.isInteger(id) || id <= 0) {
    throw new AppError(400, 'Position id must be a positive integer.');
  }

  return id;
}

function validateCreatePositionInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new AppError(400, 'Request body must be an object.');
  }

  const allowedFields = new Set(['name', 'jobLevel', 'description']);
  if (Object.keys(input).some((field) => !allowedFields.has(field))) {
    throw new AppError(400, 'Only name, jobLevel, and description are allowed when creating a position.');
  }

  if (typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 150) {
    throw new AppError(400, 'name is required and must be at most 150 characters.');
  }

  if (!Number.isInteger(input.jobLevel) || input.jobLevel < 1 || input.jobLevel > 5) {
    throw new AppError(400, 'jobLevel must be an integer between 1 and 5.');
  }

  if (input.description !== undefined && input.description !== null && typeof input.description !== 'string') {
    throw new AppError(400, 'description must be a string or null.');
  }

  return {
    name: input.name.trim(),
    jobLevel: input.jobLevel,
    description: input.description?.trim() || null
  };
}

function validateUpdatePositionInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new AppError(400, 'Request body must be an object.');
  }

  const allowedFields = new Set(['name', 'jobLevel', 'description']);
  const suppliedFields = Object.keys(input);

  if (!suppliedFields.length) {
    throw new AppError(400, 'Provide name, jobLevel, or description to update.');
  }

  if (suppliedFields.some((field) => !allowedFields.has(field))) {
    throw new AppError(400, 'Only name, jobLevel, and description can be updated.');
  }

  const position = {};

  if (Object.hasOwn(input, 'name')) {
    if (typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 150) {
      throw new AppError(400, 'name must be a non-empty string of at most 150 characters.');
    }
    position.name = input.name.trim();
  }

  if (Object.hasOwn(input, 'jobLevel')) {
    if (!Number.isInteger(input.jobLevel) || input.jobLevel < 1 || input.jobLevel > 5) {
      throw new AppError(400, 'jobLevel must be an integer between 1 and 5.');
    }
    position.jobLevel = input.jobLevel;
  }

  if (Object.hasOwn(input, 'description')) {
    if (input.description !== null && typeof input.description !== 'string') {
      throw new AppError(400, 'description must be a string or null.');
    }
    position.description = input.description?.trim() || null;
  }

  return position;
}

module.exports = { validatePositionId, validateCreatePositionInput, validateUpdatePositionInput };
