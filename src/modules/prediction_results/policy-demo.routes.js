const express = require('express');
const { validateDemoInput, validatePolicyId } = require('./policy-demo.validation');
function createPolicyDemoRouter({repository,authenticate}) {
  const router=express.Router();
  router.use(['/prediction-results','/retention-policies','/policy-recommendations'],authenticate,
    (_req,res,next)=>{res.set('Cache-Control','no-store, private');res.vary('Authorization');next();});
  const read=work=>async(req,res,next)=>{try{res.json(await work(req));}catch(error){next(error);}};
  router.post('/prediction-results/demo',async(req,res,next)=>{
    try{res.status(201).json(await repository.createDemo(req.auth.userId,validateDemoInput(req.body)));}
    catch(error){next(error);}
  });
  router.get('/prediction-results/:id',read(req=>repository.prediction(req.auth.userId,validatePolicyId(req.params.id,true))));
  router.get('/retention-policies',read(req=>repository.policies(req.auth.userId)));
  router.get('/retention-policies/:id',read(req=>repository.policies(req.auth.userId,validatePolicyId(req.params.id))));
  router.get('/policy-recommendations',read(req=>repository.recommendations(req.auth.userId)));
  router.get('/policy-recommendations/:id',read(req=>repository.recommendations(req.auth.userId,validatePolicyId(req.params.id))));
  return router;
}
module.exports = { createPolicyDemoRouter };
