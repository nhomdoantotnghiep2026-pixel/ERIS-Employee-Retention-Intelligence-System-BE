const express=require('express');
const {AppError}=require('../../common/errors/app-error');
const {MODEL_IDS}=require('./ai-review.client');
function validate(body,sample){
  const allowed=sample?['modelId','includeExplanation','sampleIndex']:['employeeId','modelId','includeExplanation'];
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!allowed.includes(k)))throw new AppError(400,'Body có trường không được hỗ trợ.');
  if(!sample&&(!Number.isInteger(body.employeeId)||body.employeeId<=0||body.employeeId>2147483647))throw new AppError(400,'employeeId phải là số nguyên dương.');
  if(body.modelId!==undefined&&!MODEL_IDS.includes(body.modelId))throw new AppError(400,'Model không được hỗ trợ.');
  if(body.includeExplanation!==undefined&&typeof body.includeExplanation!=='boolean')throw new AppError(400,'includeExplanation phải là boolean.');
  if(sample&&body.sampleIndex!==undefined&&(!Number.isInteger(body.sampleIndex)||body.sampleIndex<0||body.sampleIndex>9))throw new AppError(400,'sampleIndex phải từ 0 đến 9.');
  return body;
}
function validateBatch(body,sample){
 const allowed=sample?['modelId']:['employeeIds','modelId'];
 if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!allowed.includes(k)))throw new AppError(400,'Body batch không hợp lệ.');
 if(body.modelId!==undefined&&!MODEL_IDS.includes(body.modelId))throw new AppError(400,'Model không được hỗ trợ.');
 if(!sample&&(!Array.isArray(body.employeeIds)||body.employeeIds.length<1||body.employeeIds.length>100
   ||body.employeeIds.some(id=>!Number.isInteger(id)||id<1||id>2147483647)||new Set(body.employeeIds).size!==body.employeeIds.length))throw new AppError(400,'employeeIds cần từ 1 đến 100 ID nguyên dương, không trùng.');
 return body;
}
function createAiReviewRouter({service,authenticate}){
  const router=express.Router();
  router.use((_req,res,next)=>{res.set('Cache-Control','no-store, private');res.vary('Authorization');next();});router.use(authenticate);
  router.get('/models',async(req,res,next)=>{try{res.json(await service.models(req.auth.userId));}catch(e){next(e);}});
  router.get('/inputs',async(req,res,next)=>{try{res.json(await service.inputs(req.auth.userId));}catch(e){next(e);}});
  for(const [route,sample] of [['/predict',false],['/sample',true]])router.post(route,async(req,res,next)=>{
    try{res.json(await service.infer(req.auth.userId,validate(req.body,sample),sample));}catch(e){next(e);}
  });
  for(const [route,sample] of [['/predict/batch',false],['/sample/batch',true]])router.post(route,async(req,res,next)=>{
    try{res.json(await service.batch(req.auth.userId,validateBatch(req.body,sample),sample));}catch(e){next(e);}
  });
  return router;
}
module.exports={createAiReviewRouter,validate,validateBatch};
