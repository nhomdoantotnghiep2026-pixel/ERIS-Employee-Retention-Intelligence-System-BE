const express = require('express');

function createDepartmentsRouter({ departmentsController, authenticate }) {
  const router = express.Router();

  router.get('/listDepartments', authenticate, departmentsController.listDepartments);
  router.post('/createDepartments', authenticate, departmentsController.createDepartment);
  router.delete('/deleteDepartments/:id', authenticate, departmentsController.deactivateDepartment);
  router.patch('/updateDepartments/:id', authenticate, departmentsController.updateDepartment);

  return router;
}

module.exports = { createDepartmentsRouter };
