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

const app = express();

app.use(express.json());
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, { explorer: true }));
const authRepository = new AuthRepository(databasePool);
const authService = new AuthService({ authRepository, mailTransporter, redisClient, ensureRedisConnection });
const authController = new AuthController(authService);

app.use('/api/auth', createAuthRouter(authController));

app.get('/health', (_request, response) => {
  response.status(200).json({ status: 'ok' });
});

app.use(errorHandler);

module.exports = { app };
