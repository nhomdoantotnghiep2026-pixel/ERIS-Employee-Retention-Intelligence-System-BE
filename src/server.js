const { env } = require('./config/env');
const { app, attendanceService } = require('./app');

app.listen(env.port, () => {
  console.log(`ERIS Backend is listening on port ${env.port}.`);
  console.log(`Swagger UI is available at http://localhost:${env.port}/api-docs`);
});
const closeYesterday = () => attendanceService.closePreviousDay().catch(error => {
  console.error(`Attendance absence close failed: ${error.message}`);
});
let calendarRunning=false;
async function syncTodayCalendar() {
  if(calendarRunning)return;
  calendarRunning=true;
  try {
    await attendanceService.syncTodayHoliday();
    await attendanceService.syncTodayLeaves();
  } catch(error) {console.error(`Attendance calendar sync failed: ${error.message}`);}
  finally {calendarRunning=false;}
}
void (async()=>{await syncTodayCalendar();await closeYesterday();})();
setInterval(syncTodayCalendar, 60 * 1000).unref();
setInterval(closeYesterday, 60 * 60 * 1000).unref();
