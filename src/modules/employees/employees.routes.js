const express = require('express');
const { registerEmployeeImport } = require('./employees.import');

function createEmployeesRouter({ employeesController, authenticate }) {
  const router = express.Router();
  registerEmployeeImport(router, authenticate, employeesController.employeesService);

  router.get('/', authenticate, employeesController.listEmployees);
  router.get('/:id', authenticate, employeesController.getEmployee);
  router.post('/', authenticate, employeesController.createEmployee);
  router.delete('/:id', authenticate, employeesController.deleteEmployee);
  router.patch('/:id', authenticate, employeesController.updateEmployee);

  return router;
}

module.exports = { createEmployeesRouter };
