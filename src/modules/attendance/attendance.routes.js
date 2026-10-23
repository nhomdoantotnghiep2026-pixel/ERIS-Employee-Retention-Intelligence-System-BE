const express = require('express');
const { AppError } = require('../../common/errors/app-error');

function createAttendanceRouter({ service, authenticate, databasePool }) {
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
      if (user.employeeId == null) throw new AppError(403, 'An employee profile is required for attendance.');
      if (user.employmentStatus !== 'ACTIVE') throw new AppError(403, 'An ACTIVE employee profile is required for attendance.');
      req.attendanceUser = user;
      next();
    } catch (error) { next(error); }
  });
  const handler = work => async (req, res, next) => {
    try { res.json(await work(req)); }
    catch (error) { next(error); }
  };
  router.get('/config', handler(() => service.configuration()));
  router.get('/today', handler(req => service.today(req.attendanceUser)));
  router.post('/check-in', handler(req => service.checkIn(req.attendanceUser, req.body)));
  router.post('/check-out', handler(req => service.checkOut(req.attendanceUser, req.body)));
  // Keep business error codes local to attendance, matching the current app's message format.
  router.use((error, req, res, next) => {
    if (error instanceof AppError) return res.status(error.statusCode).json({ message: error.message, ...(error.code ? { code: error.code } : {}) });
    next(error);
  });
  return router;
}
module.exports = { createAttendanceRouter };
