const express = require('express');
const multer = require('multer');
const { AppError } = require('../../common/errors/app-error');
const { AttendanceController } = require('./attendance.controller');
function createAttendanceRouter({service,attendanceController = new AttendanceController(service),authenticate,databasePool}) {
  const router=express.Router();
  const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:10*1024*1024,files:1,fields:1,fieldSize:1024*1024,parts:2}});
  router.use((_req,res,next)=>{res.set('Cache-Control','no-store, private');res.vary('Authorization');next();});
  router.use(authenticate);
  router.use(async(req,_res,next)=>{
    try {req.attendanceUser=await service.repo.actor(databasePool,req.auth.userId);next();}catch(e){next(e);}
  });
  const hr=(req,_res,next)=>req.attendanceUser.role_name==='HR'?next():next(new AppError(403,'Only HR can manage attendance.'));
  router.post('/import/preview',hr,upload.single('file'),attendanceController.preview);
  router.post('/import/confirm',hr,upload.single('file'),attendanceController.confirm);
  router.post('/import/errors',hr,upload.single('file'),attendanceController.errors);
  router.all(['/import','/import/history','/import/:retiredId','/import/:retiredId/confirm','/import/:retiredId/errors','/import/:retiredId/rows/:excelRow'],hr,(_req,res)=>res.status(410).json({code:'IMPORT_FLOW_CHANGED',message:'Resubmit file to POST /import/preview or /import/confirm. Import history and persisted previews are no longer stored.'}));
  router.post('/reconcile/preview',hr,attendanceController.reconcilePreview);
  router.post('/reconcile/confirm',hr,attendanceController.reconcileConfirm);
  router.get('/summary',attendanceController.summary);
  router.get('/me',attendanceController.own);
  router.get('/',hr,attendanceController.list);
  router.get('/cancellations',hr,attendanceController.cancellations);
  router.get('/cancellations/:id',hr,attendanceController.cancellation);
  router.get('/:id/audit-logs',hr,attendanceController.logs);
  router.patch('/:id/cancel',hr,attendanceController.cancel);
  router.get('/:id',attendanceController.detail);
  router.use((error,_req,res,next)=>{
    if(error instanceof multer.MulterError)return res.status(400).json({code:'ATT-001',message:error.message});
    if(error instanceof AppError)return res.status(error.statusCode).json({message:error.message,...(error.code?{code:error.code}:{}),...(error.conflicts?{conflicts:error.conflicts}:{})});
    if(error.code==='23505')return res.status(409).json({code:'ATTENDANCE_CONFLICT',message:'Employee/date is already stored. If the only prior record is cancelled, the database unique index must allow a new ACTIVE replacement. No row was overwritten.'});
    next(error);
  });
  return router;
}
module.exports={createAttendanceRouter};
