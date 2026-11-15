const { env } = require('./config/env');
const { app, workSchedulesService } = require('./app');

app.listen(env.port, () => {
  console.log(`ERIS Backend is listening on port ${env.port}.`);
  console.log(`Swagger UI is available at http://localhost:${env.port}/api-docs`);
});
let schedulesRunning=false;
async function syncWorkSchedules() {
  if(schedulesRunning)return;
  schedulesRunning=true;
  try {
    await workSchedulesService.syncDefaults();
  } catch(error) {console.error(`Work schedule sync failed: ${error.message}`);}
  finally {schedulesRunning=false;}
}
void syncWorkSchedules();
setInterval(syncWorkSchedules, 60 * 1000).unref();
