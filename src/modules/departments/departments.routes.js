const express = require('express');

function createDepartmentsRouter({ departmentsController, authenticate }) {
  const router = express.Router();

  router.get('/', authenticate, departmentsController.listDepartments);
  router.post('/', authenticate, departmentsController.createDepartment);
  router.delete('/:id', authenticate, departmentsController.deactivateDepartment);
  router.patch('/:id', authenticate, departmentsController.updateDepartment);

  return router;
}

module.exports = { createDepartmentsRouter };
