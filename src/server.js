const { env } = require('./config/env');
const { app } = require('./app');

app.listen(env.port, () => {
  console.log(`ERIS Backend is listening on port ${env.port}.`);
  console.log(`Swagger UI is available at http://localhost:${env.port}/api-docs`);
});
