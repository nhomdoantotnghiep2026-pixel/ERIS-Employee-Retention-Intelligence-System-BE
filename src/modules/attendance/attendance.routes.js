const express = require('express');
const multer = require('multer');
const { AppError } = require('../../common/errors/app-error');
function createAttendanceRouter({service,authenticate,databasePool}) {
  const router=express.Router();
  const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:10*1024*1024,files:1,fields:1,fieldSize:1024*1024,parts:2}});
  router.use((_req,res,next)=>{res.set('Cache-Control','no-store, private');res.vary('Authorization');next();});
  router.use(authenticate);
  router.use(async(req,_res,next)=>{
    try {req.attendanceUser=await service.repo.actor(databasePool,req.auth.userId);next();}catch(e){next(e);}
  });
  const hr=(req,_res,next)=>req.attendanceUser.role_name==='HR'?next():next(new AppError(403,'Only HR can manage attendance.'));
  const json=fn=>async(req,res,next)=>{try{res.json(await fn(req));}catch(e){next(e);}};
  const options=req=>{if(Object.keys(req.body||{}).some(k=>k!=='options'))throw new AppError(400,'Only file and options are accepted.');let value={};if(req.body?.options){try{value=JSON.parse(req.body.options);}catch{throw new AppError(400,'options must be a JSON object.');}}return value;};
  router.post('/import/preview',hr,upload.single('file'),json(req=>service.preview(req.attendanceUser,req.file,options(req))));
  router.post('/import/confirm',hr,upload.single('file'),json(req=>service.confirm(req.attendanceUser,req.file,options(req))));
  router.post('/import/errors',hr,upload.single('file'),async(req,res,next)=>{try{const buffer=await service.errors(req.attendanceUser,req.file,options(req));res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');res.attachment('attendance-errors.xlsx');res.send(Buffer.from(buffer));}catch(e){next(e);}});
  router.all(['/import','/import/history','/import/:retiredId','/import/:retiredId/confirm','/import/:retiredId/errors','/import/:retiredId/rows/:excelRow'],hr,(_req,res)=>res.status(410).json({code:'IMPORT_FLOW_CHANGED',message:'Resubmit file to POST /import/preview or /import/confirm. Import history and persisted previews are no longer stored.'}));
  const reconcile=require('./attendance-sources.service').reconcile;
  router.post('/reconcile/preview',hr,json(req=>reconcile(service,req.attendanceUser,req.body)));
  router.post('/reconcile/confirm',hr,json(req=>reconcile(service,req.attendanceUser,req.body,true)));
  router.get('/summary',json(req=>service.list(req.attendanceUser,req.query,false,true)));
  router.get('/me',json(req=>service.list(req.attendanceUser,req.query,true)));
  router.get('/',hr,json(req=>service.list(req.attendanceUser,req.query)));
  router.get('/cancellations',hr,json(req=>service.cancellations(req.attendanceUser,req.query)));
  router.get('/cancellations/:id',hr,json(req=>service.cancellations(req.attendanceUser,{},req.params.id)));
  router.get('/:id/audit-logs',hr,json(req=>service.logs(req.attendanceUser,req.params.id,req.query)));
  router.patch('/:id/cancel',hr,json(req=>service.cancel(req.attendanceUser,req.params.id,req.body)));
  router.get('/:id',json(req=>service.detail(req.attendanceUser,req.params.id)));
  router.use((error,_req,res,next)=>{
    if(error instanceof multer.MulterError)return res.status(400).json({code:'ATT-001',message:error.message});
    if(error instanceof AppError)return res.status(error.statusCode).json({message:error.message,...(error.code?{code:error.code}:{}),...(error.conflicts?{conflicts:error.conflicts}:{})});
    if(error.code==='23505')return res.status(409).json({code:'ATTENDANCE_CONFLICT',message:'Employee/date is already stored. If the only prior record is cancelled, the database unique index must allow a new ACTIVE replacement. No row was overwritten.'});
    next(error);
  });
  return router;
}
module.exports={createAttendanceRouter};
