const { AppError } = require('../errors/app-error');

function errorHandler(error, _request, response, _next) {
  if (error instanceof AppError) {
    return response.status(error.statusCode).json({ message: error.message });
  }

  console.error('Unhandled application error:', error.message);
  return response.status(500).json({ message: 'Internal server error.' });
}

module.exports = { errorHandler };
