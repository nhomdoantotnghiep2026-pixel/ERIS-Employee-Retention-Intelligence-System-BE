const {AiPolicyRepository}=require('./ai-policy.repository');
const express=require('express');
const {AppError}=require('../../common/errors/app-error');
const {id}=require('./ai.features');
function createAiRouter({service,repository,authenticate,policyRepository=new AiPolicyRepository(repository.pool,repository)}) {
  const router=express.Router();
  router.use(authenticate,(_req,res,next)=>{res.set('Cache-Control','no-store, private');res.vary('Authorization');next();});
  const route=fn=>async(req,res,next)=>{try{res.json({data:await fn(req)});}catch(error){if(error instanceof AppError&&error.details)return res.status(error.statusCode).json({message:error.message,details:error.details});next(error);}};
  router.get('/model',route(req=>service.info(req.auth.userId)));
  router.get('/employees',route(req=>repository.employees(req.auth.userId)));
  router.get('/employees/:employeeId/snapshots',route(req=>repository.snapshots(req.auth.userId,id(req.params.employeeId))));
  router.get('/employees/:employeeId/snapshots/:snapshotId',route(req=>repository.readSnapshot(req.auth.userId,id(req.params.employeeId),id(req.params.snapshotId))));
  router.post('/employees/:employeeId/preview',route(req=>service.preview(req.auth.userId,req.params.employeeId,req.body)));
  router.post('/employees/:employeeId/predict',route(req=>service.predict(req.auth.userId,req.params.employeeId,req.body)));
  router.post('/predict-batch',route(req=>service.batch(req.auth.userId,req.body)));
  router.post('/results/:id/policy-recommendations',route(req=>policyRepository.generate(req.auth.userId,req.params.id,req.body)));
  router.get('/results/:id',route(req=>repository.result(req.auth.userId,id(req.params.id))));
  return router;
}
module.exports={createAiRouter};
