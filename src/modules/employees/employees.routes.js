const express = require('express');
const { registerEmployeeImport } = require('./employees.import');
const { validateEmployeeId } = require('./employees.validation');

function createEmployeesRouter({ employeesController, authenticate }) {
  const router = express.Router();
  registerEmployeeImport(router, authenticate, employeesController.employeesService);

  router.get('/', authenticate, employeesController.listEmployees);
  router.get('/me', authenticate, employeesController.getMyProfile);
  router.get('/account-candidates', authenticate, async (req, res, next) => {
    try {
      res.set('Cache-Control', 'no-store, private');
      res.json({ data: await employeesController.employeesService.listAccountCandidates(req.auth.userId) });
    } catch (error) { next(error); }
  });
  router.post('/:id/account', authenticate, async (req, res, next) => {
    try {
      const data = await employeesController.employeesService.provisionEmployeeAccount(req.auth.userId, validateEmployeeId(req.params.id));
      res.set('Cache-Control', 'no-store, private');
      res.status(201).json({ data });
    } catch (error) { next(error); }
  });
  router.get('/:id', authenticate, employeesController.getEmployee);
  router.post('/', authenticate, employeesController.createEmployee);
  router.delete('/:id', authenticate, employeesController.deleteEmployee);
  router.patch('/:id', authenticate, employeesController.updateEmployee);

  return router;
}

module.exports = { createEmployeesRouter };
