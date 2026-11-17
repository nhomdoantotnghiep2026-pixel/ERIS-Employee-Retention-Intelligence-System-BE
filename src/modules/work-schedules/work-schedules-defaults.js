// Retired: current schema stores employees.work_schedule_id instead of dated assignments.
// Kept as an explicit failure for integrations importing the former helper.
const {AppError}=require('../../common/errors/app-error');
class ScheduleDefaults {
 constructor(){throw new AppError(410,'Dated/default assignments were retired; use employees.work_schedule_id.');}
}
module.exports={ScheduleDefaults};
