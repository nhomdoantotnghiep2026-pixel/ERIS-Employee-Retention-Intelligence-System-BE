const express = require('express');

function createUsersRouter({ usersController, authenticate }) {
  const router = express.Router();

  const privateResponse = (_request, response, next) => {
    response.set('Cache-Control', 'no-store, private');
    response.vary('Authorization');
    next();
  };
  router.get('/', authenticate, privateResponse, usersController.listUsers);
  router.get('/:id', authenticate, privateResponse, usersController.getUser);
  router.patch('/:id/status', authenticate, usersController.updateStatus);

  return router;
}

module.exports = { createUsersRouter };
