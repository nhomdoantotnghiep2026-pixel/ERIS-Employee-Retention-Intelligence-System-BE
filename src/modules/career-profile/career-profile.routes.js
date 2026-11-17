const express=require('express');
const {positiveId,validateBody}=require('./career-profile.validation');
const {AppError}=require('../../common/errors/app-error');
function createCareerProfileRouter({service,authenticate}){
  const router=express.Router();
  const guard=[authenticate,(req,res,next)=>{
    res.set('Cache-Control','no-store, private');
    if(Object.keys(req.query).length) return next(new AppError(400,'Unsupported query parameter.'));
    next();
  }];
  const handle=(fn,status=200)=>async(req,res,next)=>{try{res.status(status).json(await fn(req));}catch(error){next(error);}};
  router.get('/me/career-goals',...guard,handle(req=>service.own(req.auth.userId)));
  router.post('/me/career-goals',...guard,handle(req=>service.own(req.auth.userId,'create',undefined,validateBody(req.body,'create')),201));
  router.patch('/me/career-goals/:id',...guard,handle(req=>service.own(req.auth.userId,'edit',positiveId(req.params.id),validateBody(req.body,'edit'))));
  for(const action of ['complete','replace','cancel']) router.post(`/me/career-goals/:id/${action}`,...guard,handle(req=>service.own(req.auth.userId,action,positiveId(req.params.id),validateBody(req.body,action))));
  router.get('/employees/:employeeId/career-goals',...guard,handle(req=>service.getEmployee(req.auth.userId,positiveId(req.params.employeeId,'employeeId'))));
  router.get('/hr/career-goals/alerts',...guard,handle(req=>service.alerts(req.auth.userId)));
  return router;
}
module.exports={createCareerProfileRouter};
