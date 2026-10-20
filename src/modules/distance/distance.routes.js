const express = require('express');
const { AppError } = require('../../common/errors/app-error');
function createDistanceRouter({ authenticate, employeesService, distanceService }) {
  const router = express.Router();
  router.get('/places', authenticate, async (request, response, next) => {
    try {
      await employeesService.assertHr(request.auth.userId);
      const { query } = request.query;
      if (Object.keys(request.query).some(k => k !== 'query') || typeof query !== 'string' || query.trim().length < 3 || query.trim().length > 300) {
        throw new AppError(400, 'query must contain 3 to 300 characters.');
      }
      response.setHeader('Cache-Control', 'no-store');
      response.json({ places: await distanceService.search(query.trim()) });
    } catch (error) { next(error); }
  });
  return router;
}
module.exports = { createDistanceRouter };
