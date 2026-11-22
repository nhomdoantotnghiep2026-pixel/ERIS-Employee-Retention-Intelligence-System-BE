const {UnifiedAnalysis,OllamaProvider}=require('./services/ai-unified.service');
const {E5Provider}=require('./providers/ai-e5.provider');
const {AiPolicyRepository}=require('./repositories/ai-policy.repository');
const {OpenAiPolicy}=require('./providers/ai-policy.openai');
const express=require('express');
const {AiController}=require('./ai.controller');
const {AppError}=require('../../common/errors/app-error');
const {registerAiInputRoutes}=require('../ai_input/ai-input.routes');
function createAiRouter({service,repository,authenticate,aiController: injectedController,policyRepository=new AiPolicyRepository(repository.pool,repository,new OpenAiPolicy())}) {
  const router=express.Router();
  const unified=new UnifiedAnalysis(service,repository,{provider:new OllamaProvider(),retriever:new E5Provider()});
  const demo=new UnifiedAnalysis(service,repository,{provider:new OllamaProvider(),retriever:null});
  const aiController=injectedController||new AiController({service,repository,unified,demo,policyRepository});
  router.use(authenticate,(_req,res,next)=>{res.set('Cache-Control','no-store, private');res.vary('Authorization');next();});
  const route=fn=>async(req,res,next)=>{try{res.json({data:await fn(req)});}catch(error){if(error instanceof AppError&&error.details)return res.status(error.statusCode).json({message:error.message,details:error.details});next(error);}};
  registerAiInputRoutes(router,{service,repository,route});
  router.get('/analysis-config',aiController.configuration);
  router.get('/model',aiController.model);
  router.get('/employees/:employeeId/results',aiController.results);
  router.post('/employees/:employeeId/predict',aiController.predict);
  router.get('/employees/:employeeId/demo-data',aiController.demoData);
  router.post('/employees/:employeeId/analyze-demo',aiController.analyzeDemo);
  router.post('/employees/:employeeId/analyze',aiController.analyze);
  router.post('/predict-batch',aiController.batch);
  router.post('/results/:id/policy-recommendations',aiController.recommendPolicies);
  router.get('/results/:id',aiController.result);
  return router;
}
module.exports={createAiRouter};
