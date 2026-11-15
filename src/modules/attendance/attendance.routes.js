const { validateAttendanceId } = require('./attendance.validation');
const express = require('express');
const { AppError } = require('../../common/errors/app-error');

function createAttendanceRouter({ service, authenticate, databasePool, syncSchedules=null }) {
  const router = express.Router();
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store, private'); res.set('Vary', 'Authorization'); next(); });
  router.use(authenticate);
  // Read live account and employee status; a disabled user cannot use an older access token.
  router.use(async (req, res, next) => {
    try {
      const { rows } = await databasePool.query(
        `SELECT u.id, u.status, u.employee_id AS "employeeId", e.employment_status AS "employmentStatus", r.name AS role_name
         FROM users u JOIN role r ON r.id = u.role_id LEFT JOIN employees e ON e.id = u.employee_id WHERE u.id = $1`, [req.auth.userId]);
      const user = rows[0];
      if (!user || user.status !== 'ACTIVE') throw new AppError(401, 'Active account required.');
      req.attendanceUser = user;
      next();
    } catch (error) { next(error); }
  });
  const handler = work => async (req, res, next) => {
    try { res.json(await work(req)); }
    catch (error) { next(error); }
  };
  const requireProfile = (_req, _res, next) => {
    const user=_req.attendanceUser;
    if(user.employeeId==null) return next(new AppError(403,'An employee profile is required for attendance.'));
    if(user.employmentStatus!=='ACTIVE') return next(new AppError(403,'An ACTIVE employee profile is required for attendance.'));
    next();
  };
  const requireHr = (req, _res, next) => req.attendanceUser.role_name==='HR' ? next() : next(new AppError(403,'Only HR can view attendance history.'));
  router.get('/', requireHr, handler(req => service.list(req.attendanceUser,req.query.recordStatus)));
  require('./attendance.import').registerImport(router, requireHr, databasePool);
  router.delete('/:id', requireHr, handler(req=>require('./attendance.cancellation').cancelAttendance(databasePool,req.auth.userId,req.params.id,req.body)));
  router.get('/company-location', requireHr, handler(req => service.companyLocation(req.attendanceUser)));
  router.put('/company-location', requireHr, handler(req => service.updateCompanyLocation(req.attendanceUser, req.body)));
  router.get('/config', requireProfile, handler(req => service.configuration(req.attendanceUser)));
  router.get('/today', requireProfile, handler(req => service.today(req.attendanceUser)));
  router.post('/leave-requests', requireProfile, handler(req => service.requestLeave(req.attendanceUser,req.body)));
  router.get('/leave-requests/me', requireProfile, handler(req => service.myLeaveRequests(req.attendanceUser)));
  router.get('/leave-requests', requireHr, handler(req => service.leaveRequests(req.attendanceUser)));
  router.get('/leave-requests/:id/history', requireProfile, handler(req => service.leaveHistory(req.attendanceUser,req.params.id)));
  router.patch('/leave-requests/:id', requireHr, handler(req => service.reviewLeave(req.attendanceUser,req.params.id,req.body)));
  router.post('/leave-requests/:id/cancellation', requireProfile, handler(req => service.requestLeaveCancellation(req.attendanceUser,req.params.id,req.body)));
  router.patch('/leave-requests/:id/cancellation', requireHr, handler(req => service.reviewLeaveCancellation(req.attendanceUser,req.params.id,req.body)));
  router.get('/holidays', requireHr, handler(req => service.holidays(req.attendanceUser)));
  router.post('/holidays', requireHr, handler(req => service.createHoliday(req.attendanceUser,req.body)));
  router.put('/holidays/:id', requireHr, handler(req => service.updateHoliday(req.attendanceUser,req.params.id,req.body)));
  router.delete('/holidays/:id', requireHr, async (req, res, next) => {
    try {
      await service.deleteHoliday(req.attendanceUser,req.params.id);
      res.status(204).end();
    } catch (error) { next(error); }
  });
  router.get('/:id', requireHr, handler(req => service.detail(req.attendanceUser, validateAttendanceId(req.params.id))));
  // Keep business error codes local to attendance, matching the current app's message format.
  router.use((error, req, res, next) => {
    if (error instanceof AppError) return res.status(error.statusCode).json({ message: error.message, ...(error.code ? { code: error.code } : {}) });
    next(error);
  });
  return router;
}
module.exports = { createAttendanceRouter };
