const express = require('express');

function createPositionsRouter({ positionsController, authenticate }) {
  const router = express.Router();

  router.post('/', authenticate, positionsController.createPosition);
  router.get('/listPositions', authenticate, positionsController.listPositions);
  router.get('/:id', authenticate, positionsController.getPosition);
  router.patch('/:id', authenticate, positionsController.updatePosition);

  return router;
}

module.exports = { createPositionsRouter };
