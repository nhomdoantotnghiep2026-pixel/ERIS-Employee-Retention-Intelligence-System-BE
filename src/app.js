const express = require('express');
const swaggerUi = require('swagger-ui-express');
const { errorHandler } = require('./common/middleware/error-handler');
const { databasePool } = require('./config/database');
const { mailTransporter } = require('./config/mail');
const { ensureRedisConnection, redisClient } = require('./config/redis');
const { swaggerSpec } = require('./config/swagger');
const { AuthController } = require('./modules/auth/auth.controller');
const { AuthRepository } = require('./modules/auth/auth.repository');
const { createAuthRouter } = require('./modules/auth/auth.routes');
const { AuthService } = require('./modules/auth/auth.service');
const { authenticate } = require('./common/middleware/authenticate');
const { DepartmentsController } = require('./modules/departments/departments.controller');
const { DepartmentsRepository } = require('./modules/departments/departments.repository');
const { createDepartmentsRouter } = require('./modules/departments/departments.routes');
const { DepartmentsService } = require('./modules/departments/departments.service');
const { EmployeesController } = require('./modules/employees/employees.controller');
const { EmployeesRepository } = require('./modules/employees/employees.repository');
const { createEmployeesRouter } = require('./modules/employees/employees.routes');
const { EmployeesService } = require('./modules/employees/employees.service');
const { JobHistoriesRepository } = require('./modules/job-histories/job-histories.repository');
const { JobHistoriesService } = require('./modules/job-histories/job-histories.service');
const { createJobHistoriesRouter, createOwnJobHistoriesRouter } = require('./modules/job-histories/job-histories.routes');
const { PositionsController } = require('./modules/positions/positions.controller');
const { PositionsRepository } = require('./modules/positions/positions.repository');
const { createPositionsRouter } = require('./modules/positions/positions.routes');
const { PositionsService } = require('./modules/positions/positions.service');
const { SurveysController } = require('./modules/surveys/surveys.controller');
const { SurveysRepository } = require('./modules/surveys/surveys.repository');
const { createSurveysRouter } = require('./modules/surveys/surveys.routes');
const { SurveysService } = require('./modules/surveys/surveys.service');
const { UsersController } = require('./modules/users/users.controller');
const { UsersRepository } = require('./modules/users/users.repository');
const { createUsersRouter } = require('./modules/users/users.routes');
const { UsersService } = require('./modules/users/users.service');

const app = express();

app.use(express.json());
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, { explorer: true }));
const authRepository = new AuthRepository(databasePool);
const authService = new AuthService({ authRepository, mailTransporter, redisClient, ensureRedisConnection });
const authController = new AuthController(authService);
const departmentsRepository = new DepartmentsRepository(databasePool);
const departmentsService = new DepartmentsService({ departmentsRepository });
const departmentsController = new DepartmentsController(departmentsService);
const employeesRepository = new EmployeesRepository(databasePool);
const { EducationRepository } = require('./modules/employee-education/education.repository');
const { EducationService } = require('./modules/employee-education/education.service');
const educationService = new EducationService(new EducationRepository(databasePool));
const { WorkExperiencesRepository } = require('./modules/work-experiences/work-experiences.repository');
const { WorkExperiencesService } = require('./modules/work-experiences/work-experiences.service');
const { createWorkExperiencesRouter } = require('./modules/work-experiences/work-experiences.routes');
const workExperiencesService = new WorkExperiencesService(new WorkExperiencesRepository(databasePool));
const { createDistanceService } = require('./modules/distance/distance.service');
const { distanceConfig } = require('./config/distance');
const distanceService = createDistanceService(distanceConfig());
const employeesService = new EmployeesService({
  employeesRepository, distanceService, educationService,
  mailTransporter, mailFrom: require('./config/env').env.mail.from,
  initialPassword: process.env.INITIAL_USER_PASSWORD
});
const employeesController = new EmployeesController(employeesService);
const positionsRepository = new PositionsRepository(databasePool);
const positionsService = new PositionsService({ positionsRepository });
const positionsController = new PositionsController(positionsService);
const surveysRepository = new SurveysRepository(databasePool);
const surveysService = new SurveysService({ surveysRepository });
const surveysController = new SurveysController(surveysService);
const usersRepository = new UsersRepository(databasePool);
const usersService = new UsersService({ usersRepository });
const usersController = new UsersController(usersService);

app.get('/employee-education-demo', (_req,res) => { res.set('Cache-Control','no-store');res.sendFile(require('node:path').join(__dirname,'../demo/employee-education/index.html')); });
app.use('/employee-education-demo/assets', express.static(require('node:path').join(__dirname,'../demo/employee-education'),{index:false,etag:false,setHeaders:res=>res.set('Cache-Control','no-store')}));
app.get('/employee-create-demo', (_req, res) => { res.set('Cache-Control', 'no-store'); res.sendFile(require('node:path').join(__dirname, '../demo/employee-create/index.html')); });
app.use('/employee-create-demo/assets', express.static(require('node:path').join(__dirname, '../demo/employee-create'), { index: false, etag: false, setHeaders: res => res.set('Cache-Control', 'no-store') }));
app.use('/api/distance', require('./modules/distance/distance.routes').createDistanceRouter({ authenticate, employeesService, distanceService }));

app.use('/api/auth', createAuthRouter(authController));
app.use('/api/departments', createDepartmentsRouter({ departmentsController, authenticate }));
const { createEducationRouter, createAllEducationRouter, createOwnEducationRouter } = require('./modules/employee-education/education.routes');
const jobHistoriesService = new JobHistoriesService(new JobHistoriesRepository(databasePool));
app.use('/api/employee-educations', createAllEducationRouter({ service: educationService, authenticate }));
app.use('/api/employee-work-experiences', createWorkExperiencesRouter({ service: workExperiencesService, authenticate, all: true }));
app.use('/api/employees/:employeeId/work-experiences', createWorkExperiencesRouter({ service: workExperiencesService, authenticate }));
app.use('/api/employees/me/educations', createOwnEducationRouter({ service: educationService, authenticate }));
app.use('/api/employees/me/job-histories', createOwnJobHistoriesRouter({ service: jobHistoriesService, authenticate }));
app.use('/api/employees/:employeeId/educations', createEducationRouter({ service: educationService, authenticate }));
app.use('/api/employees/:employeeId/job-histories', createJobHistoriesRouter({
  service: jobHistoriesService, authenticate
}));
app.use('/api/job-histories', createJobHistoriesRouter({
  service: jobHistoriesService, authenticate
}));
app.use('/api/employees', createEmployeesRouter({ employeesController, authenticate }));
app.use('/api/positions', createPositionsRouter({ positionsController, authenticate }));
app.use('/api/surveys', createSurveysRouter({ surveysController, authenticate }));
app.use('/api/users', createUsersRouter({ usersController, authenticate }));
const { AuditReadRepository } = require('./modules/audit_logs/audit-read.repository');
const { AuditReadService } = require('./modules/audit_logs/audit-read.service');
const { createAuditReadRouter } = require('./modules/audit_logs/audit-read.routes');
const auditReadService = new AuditReadService(new AuditReadRepository(databasePool));
app.use('/api/audit-logs', createAuditReadRouter({ service: auditReadService, authenticate }));

app.get('/health', (_request, response) => {
  response.status(200).json({ status: 'ok' });
});


const { createAttendanceService } = require('./modules/attendance/attendance.service');
const { AttendanceRepository } = require('./modules/attendance/attendance.repository');
const { attendanceConfig } = require('./modules/attendance/attendance.config');
const attendanceService = createAttendanceService(attendanceConfig(), new AttendanceRepository(databasePool));
app.use('/api/v1/attendance', require('./modules/attendance/attendance.routes').createAttendanceRouter({ service: attendanceService, authenticate, databasePool }));
app.use(errorHandler);

module.exports = { app };
