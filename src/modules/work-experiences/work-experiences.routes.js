const express = require('express');
const { validateId } = require('../employee-education/education.validation');
function createWorkExperiencesRouter({ service, authenticate, all = false }) {
  const router = express.Router({ mergeParams: true });
  router.use(authenticate);
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store, private'); next(); });
  router.get('/', async (req, res, next) => {
    try {
      res.json(all ? await service.listAll(req.auth.userId)
        : await service.list(req.auth.userId, validateId(req.params.employeeId, 'employeeId')));
    } catch (error) { next(error); }
  });
  if (!all) router.post('/', async (req, res, next) => {
    try {
      res.status(201).json(await service.create(req.auth.userId, validateId(req.params.employeeId, 'employeeId'), req.body));
    } catch (error) { next(error); }
  });
  if (!all) router.delete('/:experienceId', async (req, res, next) => {
    try {
      res.json(await service.delete(req.auth.userId, validateId(req.params.employeeId, 'employeeId'), validateId(req.params.experienceId, 'experienceId')));
    } catch (error) { next(error); }
  });
  return router;
}
module.exports = { createWorkExperiencesRouter };
