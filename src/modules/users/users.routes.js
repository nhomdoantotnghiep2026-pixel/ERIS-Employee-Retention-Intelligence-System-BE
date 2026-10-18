const express = require('express');

function createUsersRouter({ usersController, authenticate }) {
  const router = express.Router();

  router.patch('/:id/status', authenticate, usersController.updateStatus);

  return router;
}

module.exports = { createUsersRouter };
