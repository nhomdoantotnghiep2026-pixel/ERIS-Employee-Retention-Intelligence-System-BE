const express = require('express');
const multer = require('multer');
const { AppError } = require('../../common/errors/app-error');
function createAttendanceRouter({service,authenticate,databasePool}) {
  const router=express.Router();
  const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:10*1024*1024,files:1,fields:0}});
  router.use((_req,res,next)=>{res.set('Cache-Control','no-store, private');res.vary('Authorization');next();});
  router.use(authenticate);
  router.use(async(req,_res,next)=>{
    try {req.attendanceUser=await service.repo.actor(databasePool,req.auth.userId);next();}catch(e){next(e);}
  });
  const hr=(req,_res,next)=>req.attendanceUser.role_name==='HR'?next():next(new AppError(403,'Only HR can manage attendance.'));
  const json=fn=>async(req,res,next)=>{try{res.json(await fn(req));}catch(e){next(e);}};
  router.post('/import',hr,(_req,res)=>res.status(410).json({code:'IMPORT_RETIRED',message:'Use POST /import/preview and POST /import/:batchId/confirm. Attendance metrics are calculated by the server.'}));
  router.post('/import/preview',hr,upload.single('file'),json(req=>service.preview(req.attendanceUser,req.file)));
  router.get('/import/history',hr,json(req=>service.history(req.attendanceUser,req.query)));
  router.get('/import/:batchId',hr,json(req=>service.batch(req.attendanceUser,req.params.batchId)));
  router.patch('/import/:batchId/rows/:excelRow',hr,json(req=>service.resolve(req.attendanceUser,req.params.batchId,req.params.excelRow,req.body)));
  router.post('/import/:batchId/confirm',hr,json(req=>service.confirm(req.attendanceUser,req.params.batchId,req.body)));
  router.get('/import/:batchId/errors',hr,async(req,res,next)=>{
    try{const buffer=await service.errors(req.attendanceUser,req.params.batchId);res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');res.attachment('attendance-errors.xlsx');res.send(Buffer.from(buffer));}catch(e){next(e);}
  });
  router.get('/summary',json(req=>service.list(req.attendanceUser,req.query,false,true)));
  router.get('/me',json(req=>service.list(req.attendanceUser,req.query,true)));
  router.get('/',hr,json(req=>service.list(req.attendanceUser,req.query)));
  router.get('/:id/audit-logs',hr,json(req=>service.logs(req.attendanceUser,req.params.id,req.query)));
  router.patch('/:id/cancel',hr,json(req=>service.mutate(req.attendanceUser,req.params.id,req.body,'CANCEL')));
  router.patch('/:id/restore',hr,json(req=>service.mutate(req.attendanceUser,req.params.id,req.body,'RESTORE')));
  router.patch('/:id',hr,json(req=>service.mutate(req.attendanceUser,req.params.id,req.body,'UPDATE')));
  router.get('/:id',json(req=>service.detail(req.attendanceUser,req.params.id)));
  router.use((error,_req,res,next)=>{
    if(error instanceof multer.MulterError)return res.status(400).json({code:'ATT-001',message:error.message});
    if(error instanceof AppError)return res.status(error.statusCode).json({message:error.message,...(error.code?{code:error.code}:{}),...(error.conflicts?{conflicts:error.conflicts}:{})});
    if(error.code==='23505')return res.status(409).json({code:'ATTENDANCE_CONFLICT',message:'Data changed concurrently; reload preview.'});
    next(error);
  });
  return router;
}
module.exports={createAttendanceRouter};
