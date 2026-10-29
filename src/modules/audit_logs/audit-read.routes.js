const express = require('express');
const { validateAuditLogId } = require('./audit-read.validation');
function createAuditReadRouter({ service, authenticate }) {
  const router = express.Router();
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store, private'); res.vary('Authorization'); next(); });
  router.use(authenticate);
  router.get('/', async (req, res, next) => {
    try { res.json(await service.list(req.auth.userId)); }
    catch (error) { next(error); }
  });
  router.get('/:id', async (req, res, next) => {
    try { res.json(await service.detail(req.auth.userId, validateAuditLogId(req.params.id))); }
    catch (error) { next(error); }
  });
  return router;
}
module.exports = { createAuditReadRouter };
