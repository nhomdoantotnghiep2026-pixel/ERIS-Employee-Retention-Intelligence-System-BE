const { AppError } = require('../../common/errors/app-error');

function validateDateTime(value, fieldName) {
  if (value === undefined || value === null || value === '') return null;

  if (typeof value !== 'string') {
    throw new AppError(400, `${fieldName} must be an ISO-8601 date-time string.`);
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new AppError(400, `${fieldName} must be a valid date-time.`);
  }

  return date.toISOString();
}

function validateCreateSurveyInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new AppError(400, 'Request body must be an object.');
  }

  const allowedFields = new Set(['title', 'description', 'startDate', 'endDate']);
  if (Object.keys(input).some((field) => !allowedFields.has(field))) {
    throw new AppError(400, 'Request body contains unsupported fields.');
  }

  if (typeof input.title !== 'string' || !input.title.trim() || input.title.trim().length > 255) {
    throw new AppError(400, 'title is required and must be at most 255 characters.');
  }

  if (input.description !== undefined && input.description !== null && typeof input.description !== 'string') {
    throw new AppError(400, 'description must be a string or null.');
  }

  const startDate = validateDateTime(input.startDate, 'startDate');
  const endDate = validateDateTime(input.endDate, 'endDate');
  if (startDate && endDate && new Date(endDate) < new Date(startDate)) {
    throw new AppError(400, 'endDate must be on or after startDate.');
  }

  return {
    title: input.title.trim(),
    description: input.description?.trim() || null,
    startDate,
    endDate
  };
}

function validateSurveyId(value) {
  const id = Number(value);

  if (!Number.isInteger(id) || id <= 0) {
    throw new AppError(400, 'Survey id must be a positive integer.');
  }

  return id;
}

function validateSubmitSurveyResponseInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new AppError(400, 'Request body must be an object.');
  }

  if (Object.keys(input).some((field) => field !== 'answers')) {
    throw new AppError(400, 'Request body contains unsupported fields.');
  }

  if (!Array.isArray(input.answers)) {
    throw new AppError(400, 'answers must be an array.');
  }

  const questionIds = new Set();
  const answers = input.answers.map((answer, index) => {
    if (!answer || typeof answer !== 'object' || Array.isArray(answer)) {
      throw new AppError(400, `answers[${index}] must be an object.`);
    }

    if (Object.keys(answer).some((field) => !['questionId', 'score', 'comment'].includes(field))) {
      throw new AppError(400, `answers[${index}] contains unsupported fields.`);
    }

    if (!Number.isInteger(answer.questionId) || answer.questionId <= 0) {
      throw new AppError(400, `answers[${index}].questionId must be a positive integer.`);
    }

    if (questionIds.has(answer.questionId)) {
      throw new AppError(400, 'Each question can only be answered once.');
    }
    questionIds.add(answer.questionId);

    if (!Number.isInteger(answer.score) || answer.score < 1 || answer.score > 4) {
      throw new AppError(400, `answers[${index}].score must be an integer between 1 and 4.`);
    }

    if (answer.comment !== undefined && answer.comment !== null && typeof answer.comment !== 'string') {
      throw new AppError(400, `answers[${index}].comment must be a string or null.`);
    }

    if (typeof answer.comment === 'string' && answer.comment.trim().length > 1000) {
      throw new AppError(400, `answers[${index}].comment must be at most 1000 characters.`);
    }

    return {
      questionId: answer.questionId,
      score: answer.score,
      comment: answer.comment?.trim() || null
    };
  });

  return { answers };
}

module.exports = { validateCreateSurveyInput, validateSurveyId, validateSubmitSurveyResponseInput };
