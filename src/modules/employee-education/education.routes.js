const express = require('express');
const { validateId, validateEducation, validateInstitutionQuery } = require('./education.validation');
function createEducationRouter({service, authenticate}) {
  const router=express.Router({mergeParams:true});
  router.use(authenticate);
  router.use((_req,res,next)=>{res.set('Cache-Control','no-store, private');next();});
  const handler=(method,status)=>async(req,res,next)=>{
    try {
      const actorId=req.auth.userId,employeeId=validateId(req.params.employeeId,'employeeId');
      let result;
      if(method==='list')result=await service.list(actorId,employeeId);
      if(method==='create')result=await service.create(actorId,employeeId,validateEducation(req.body));
      if(method==='update')result=await service.update(actorId,employeeId,validateId(req.params.educationId,'educationId'),validateEducation(req.body,{partial:true}));
      if(method==='delete')result=await service.delete(actorId,employeeId,validateId(req.params.educationId,'educationId'));
      res.status(status).json(result);
    } catch(error){next(error);}
  };
  router.post('/',handler('create',201));router.get('/',handler('list',200));
  router.patch('/:educationId',handler('update',200));router.delete('/:educationId',handler('delete',200));
  return router;
}
function createAllEducationRouter({service,authenticate}) {
  const router=express.Router();
  router.get('/employees',authenticate,async(req,res,next)=>{
    try { res.set('Cache-Control','no-store, private');res.json(await service.activeEmployees(req.auth.userId)); }
    catch(error){next(error);}
  });
  router.get('/institutions',authenticate,async(req,res,next)=>{
    try { res.set('Cache-Control','no-store, private');res.json(await service.institutions(req.auth.userId,validateInstitutionQuery(req.query))); }
    catch(error){next(error);}
  });
  router.get('/',authenticate,async(req,res,next)=>{
    try { res.set('Cache-Control','no-store, private');res.json(await service.listAll(req.auth.userId)); }
    catch(error){next(error);}
  });
  return router;
}
module.exports = { createEducationRouter, createAllEducationRouter };
