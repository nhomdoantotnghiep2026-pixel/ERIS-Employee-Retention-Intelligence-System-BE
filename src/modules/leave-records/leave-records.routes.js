const express=require('express');
const multer=require('multer');
const {AppError}=require('../../common/errors/app-error');
function createLeaveRecordsRouter({service,authenticate}){
 const router=express.Router(),upload=multer({storage:multer.memoryStorage(),limits:{fileSize:10*1024*1024,files:1,fields:1}});
 router.use(['/leave-records','/leave-types'],authenticate,(_req,res,next)=>{res.set('Cache-Control','no-store, private');res.vary('Authorization');next();});
 const handle=(fn,status=200)=>async(req,res,next)=>{try{res.status(status).json(await fn(req));}catch(e){next(e);}};
 const hr=async(req,_res,next)=>{try{await service.repo.actor(service.repo.pool,req.auth.userId);next();}catch(e){next(e);}};
 router.get('/leave-types',handle(r=>service.types(r.auth.userId)));
 router.get('/leave-records/me',handle(r=>service.list(r.auth.userId,r.query,true)));
 router.get('/leave-records/summary',hr,handle(r=>service.list(r.auth.userId,r.query,false,true)));
 router.get('/leave-records',hr,handle(r=>service.list(r.auth.userId,r.query)));
 router.post('/leave-records',hr,handle(r=>service.create(r.auth.userId,r.body),201));
 router.post('/leave-records/import/preview',hr,upload.single('file'),handle(r=>service.import(r.auth.userId,r.file)));
 router.post('/leave-records/import/confirm',hr,upload.single('file'),handle(r=>service.import(r.auth.userId,r.file,true,r.body.fingerprint)));
 router.get('/leave-records/:id',hr,handle(r=>service.detail(r.auth.userId,r.params.id)));
 router.patch('/leave-records/:id',hr,handle(r=>service.mutate(r.auth.userId,r.params.id,r.body)));
 for(const action of ['cancel','restore'])router.patch('/leave-records/:id/'+action,hr,handle(r=>service.mutate(r.auth.userId,r.params.id,r.body,action.toUpperCase())));
 router.use((e,_req,res,next)=>{if(e instanceof multer.MulterError)return res.status(400).json({code:'INVALID_FILE',message:e.message});if(e instanceof AppError)return res.status(e.statusCode).json({statusCode:e.statusCode,code:e.code,message:e.message,...(e.conflicts?{conflicts:e.conflicts}:{})});next(e);});
 return router;
}
module.exports={createLeaveRecordsRouter};
