const { AppError } = require('../errors/app-error');

function errorHandler(error, _request, response, _next) {
  if (error.type === 'entity.parse.failed' && error.status === 400) {
    return response.status(400).json({ message: 'Request body must contain a valid JSON object.' });
  }
  if (error instanceof AppError) {
    return response.status(error.statusCode).json({ message: error.message });
  }

  console.error('Unhandled application error:', error.message);
  return response.status(500).json({ message: 'Internal server error.' });
}

module.exports = { errorHandler };
