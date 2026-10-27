const express = require('express');
const { positiveId } = require('./job-histories.validation');

function createJobHistoriesRouter({ service, authenticate }) {
  const router = express.Router({ mergeParams: true });
  router.use(authenticate);
  router.use((_request, response, next) => {
    response.set('Cache-Control', 'no-store, private');
    next();
  });
  router.get('/', async (request, response, next) => {
    try {
      response.json(request.params.employeeId
        ? await service.list(request.auth.userId, positiveId(request.params.employeeId, 'employeeId'))
        : await service.listAll(request.auth.userId));
    } catch (error) { next(error); }
  });
  return router;
}

function createOwnJobHistoriesRouter({ service, authenticate }) {
  const router = express.Router();
  router.use(authenticate);
  router.use((_request, response, next) => {
    response.set('Cache-Control', 'no-store, private');
    next();
  });
  router.get('/', async (request, response, next) => {
    try { response.json(await service.listOwn(request.auth.userId)); }
    catch (error) { next(error); }
  });
  return router;
}

module.exports = { createJobHistoriesRouter, createOwnJobHistoriesRouter };
