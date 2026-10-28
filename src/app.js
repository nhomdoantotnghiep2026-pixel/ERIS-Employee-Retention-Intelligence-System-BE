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
const { PositionsController } = require('./modules/positions/positions.controller');
const { PositionsRepository } = require('./modules/positions/positions.repository');
const { createPositionsRouter } = require('./modules/positions/positions.routes');
const { PositionsService } = require('./modules/positions/positions.service');
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
const { createDistanceService } = require('./modules/distance/distance.service');
const { distanceConfig } = require('./config/distance');
const distanceService = createDistanceService(distanceConfig());
const employeesService = new EmployeesService({
  employeesRepository, distanceService,
  mailTransporter, mailFrom: require('./config/env').env.mail.from,
  initialPassword: process.env.INITIAL_USER_PASSWORD
});
const employeesController = new EmployeesController(employeesService);
const positionsRepository = new PositionsRepository(databasePool);
const positionsService = new PositionsService({ positionsRepository });
const positionsController = new PositionsController(positionsService);
const usersRepository = new UsersRepository(databasePool);
const usersService = new UsersService({ usersRepository });
const usersController = new UsersController(usersService);

app.get('/employee-create-demo', (_req, res) => res.sendFile(require('node:path').join(__dirname, '../demo/employee-create/index.html')));
app.use('/employee-create-demo/assets', express.static(require('node:path').join(__dirname, '../demo/employee-create'), { index: false }));
app.use('/api/distance', require('./modules/distance/distance.routes').createDistanceRouter({ authenticate, employeesService, distanceService }));

app.use('/api/auth', createAuthRouter(authController));
app.use('/api/departments', createDepartmentsRouter({ departmentsController, authenticate }));
app.use('/api/employees', createEmployeesRouter({ employeesController, authenticate }));
app.use('/api/positions', createPositionsRouter({ positionsController, authenticate }));
app.use('/api/users', createUsersRouter({ usersController, authenticate }));

app.get('/health', (_request, response) => {
  response.status(200).json({ status: 'ok' });
});


const { createAttendanceService } = require('./modules/attendance/attendance.service');
const { AttendanceRepository } = require('./modules/attendance/attendance.repository');
const { attendanceConfig } = require('./modules/attendance/attendance.config');
const { CompanyLocationStore } = require('./modules/attendance/company-location.store');
const attendanceSettings = attendanceConfig();
const companyLocationStore = new CompanyLocationStore({
  redisClient, ensureRedisConnection,
  fallback: { latitude: attendanceSettings.attendance.latitude, longitude: attendanceSettings.attendance.longitude,
    address: process.env.COMPANY_LOCATION_LABEL || 'FPT University HCMC' }
});
const attendanceService = createAttendanceService(attendanceSettings, new AttendanceRepository(databasePool), undefined, companyLocationStore);

const companyDemoPath = require('node:path').join(__dirname, '../demo/company-location');
app.get('/company-location-demo', (_req, res) => { res.set('Cache-Control', 'no-store'); res.sendFile(require('node:path').join(companyDemoPath, 'index.html')); });
app.use('/company-location-demo/assets', express.static(companyDemoPath, { index: false, etag: false, setHeaders: res => res.set('Cache-Control', 'no-store') }));
app.use('/api/v1/attendance', require('./modules/attendance/attendance.routes').createAttendanceRouter({ service: attendanceService, authenticate, databasePool }));
app.use(errorHandler);

module.exports = { app };
