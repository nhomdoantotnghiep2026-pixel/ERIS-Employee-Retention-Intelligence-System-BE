const {id}=require('./helpers/ai-input.features');

function registerAiInputRoutes(router,{service,repository,route}){
  router.get('/exchange-rate',route(req=>service.exchangeRate(req.auth.userId)));
  router.get('/employees',route(req=>repository.employees(req.auth.userId)));
  router.get('/employees/:employeeId/snapshots',route(req=>repository.snapshots(req.auth.userId,id(req.params.employeeId))));
  router.get('/employees/:employeeId/snapshots/:snapshotId',route(req=>repository.readSnapshot(req.auth.userId,id(req.params.employeeId),id(req.params.snapshotId))));
  router.post('/employees/:employeeId/preview',route(req=>service.preview(req.auth.userId,req.params.employeeId,req.body)));
}
module.exports={registerAiInputRoutes};
