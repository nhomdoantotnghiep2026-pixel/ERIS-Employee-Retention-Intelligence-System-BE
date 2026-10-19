const express = require('express');

function createEmployeesRouter({ employeesController, authenticate }) {
  const router = express.Router();

  router.post('/', authenticate, employeesController.createEmployee);
  router.patch('/:id', authenticate, employeesController.updateEmployee);

  return router;
}

module.exports = { createEmployeesRouter };
