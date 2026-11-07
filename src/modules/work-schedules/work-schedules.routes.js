const express = require('express');
function createWorkSchedulesRouter({ service, authenticate }) {
  const router = express.Router();
  router.post('/', authenticate, async (request, response, next) => {
    try {
      const data = await service.create(request.auth.userId, request.body);
      return response.status(201).json({ message: 'Work schedule created successfully.', data });
    } catch (error) { return next(error); }
  });
  router.get('/', authenticate, async (request, response, next) => {
    try {
      const data = await service.list(request.auth.userId);
      return response.status(200).json({ data });
    } catch (error) { return next(error); }
  });
  router.patch('/:id', authenticate, async (request, response, next) => {
    try {
      const data = await service.update(request.auth.userId, request.params.id, request.body);
      return response.status(200).json({ message: 'Work schedule updated successfully.', data });
    } catch (error) { return next(error); }
  });
  router.patch('/:id/default', authenticate, async (request, response, next) => {
    try {
      const data = await service.setDefault(request.auth.userId, request.params.id, request.body);
      return response.status(200).json({ message: 'Default work schedule set successfully.', data });
    } catch (error) { return next(error); }
  });
  return router;
}
module.exports = { createWorkSchedulesRouter };

function createScheduleAssignmentsRouter({ service, authenticate }) {
  const router = express.Router();
  router.get('/:id/schedule-assignments', authenticate, async (request, response, next) => {
    try {
      const data = await service.listAssignments(request.auth.userId, request.params.id);
      return response.status(200).json({ data });
    } catch (error) { return next(error); }
  });
  router.post('/:id/schedule-assignments', authenticate, async (request, response, next) => {
    try {
      const data = await service.assign(request.auth.userId, request.params.id, request.body);
      return response.status(201).json({ message: 'Work schedule assigned successfully.', data });
    } catch (error) { return next(error); }
  });
  return router;
}
module.exports.createScheduleAssignmentsRouter = createScheduleAssignmentsRouter;