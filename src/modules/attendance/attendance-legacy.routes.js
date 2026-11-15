// Existing leave/calendar/location APIs remain available for their separate demos.
// GPS, close-day and read-triggered attendance creation are deliberately not mounted.
const express=require('express');
const { AppError }=require('../../common/errors/app-error');
function createAttendanceLegacyRouter({service,authenticate,databasePool}) {
  const router=express.Router();
  router.use(['/company-location','/holidays','/leave-requests'],authenticate,async(req,_res,next)=>{try{
    const {rows}=await databasePool.query(`SELECT u.id,u.status,u.employee_id AS "employeeId",e.employment_status AS "employmentStatus",r.name AS role_name
      FROM users u JOIN role r ON r.id=u.role_id LEFT JOIN employees e ON e.id=u.employee_id WHERE u.id=$1`,[req.auth.userId]);
    if(!rows[0]||rows[0].status!=='ACTIVE')throw new AppError(401,'Active account required.');
    if(rows[0].employeeId==null||rows[0].employmentStatus!=='ACTIVE')throw new AppError(403,'An active linked employee profile is required.');
    req.attendanceUser=rows[0];next();
  }catch(e){next(e);}});
  const h=fn=>async(req,res,next)=>{try{res.json(await fn(req));}catch(e){next(e);}};
  router.get('/company-location',h(r=>service.companyLocation(r.attendanceUser)));
  router.put('/company-location',h(r=>service.updateCompanyLocation(r.attendanceUser,r.body)));
  router.get('/holidays',h(r=>service.holidays(r.attendanceUser)));
  router.post('/holidays',h(r=>service.createHoliday(r.attendanceUser,r.body)));
  router.put('/holidays/:id',h(r=>service.updateHoliday(r.attendanceUser,r.params.id,r.body)));
  router.delete('/holidays/:id',h(r=>service.deleteHoliday(r.attendanceUser,r.params.id)));
  router.post('/leave-requests',h(r=>service.requestLeave(r.attendanceUser,r.body)));
  router.get('/leave-requests/me',h(r=>service.myLeaveRequests(r.attendanceUser)));
  router.get('/leave-requests',h(r=>service.leaveRequests(r.attendanceUser)));
  router.get('/leave-requests/:id/history',h(r=>service.leaveHistory(r.attendanceUser,r.params.id)));
  router.patch('/leave-requests/:id',h(async r=>({...await service.reviewLeave(r.attendanceUser,r.params.id,r.body),attendanceScheduled:false})));
  router.post('/leave-requests/:id/cancellation',h(r=>service.requestLeaveCancellation(r.attendanceUser,r.params.id,r.body)));
  router.patch('/leave-requests/:id/cancellation',h(r=>service.reviewLeaveCancellation(r.attendanceUser,r.params.id,r.body)));
  return router;
}
module.exports={createAttendanceLegacyRouter};
