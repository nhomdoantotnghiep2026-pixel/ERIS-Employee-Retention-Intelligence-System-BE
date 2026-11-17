const { AppError } = require('../../common/errors/app-error');
const { timeline, policy } = require('../attendance/attendance-import.rules');
function timeValue(value, field) {
  if (typeof value !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,6})?)?$/.test(value)) throw new AppError(400, `${field} must be a valid time (HH:mm or HH:mm:ss, with optional fractional seconds).`);
  const [h, m, s = '0'] = value.split(':');
  return Number(h) * 3600 + Number(m) * 60 + Number(s);
}
function validateCreateScheduleInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AppError(400, 'Request body must be an object.');
  const allowed = new Set(['name', 'start_time', 'end_time', 'break_start', 'break_end', 'working_days', 'status', 'shift_type', 'attendance_policy']);
  if (Object.keys(input).some(key => !allowed.has(key))) throw new AppError(400, 'Only schedule fields, shift_type and attendance_policy are allowed.');
  if (typeof input.name !== 'string' || !input.name.trim() || Array.from(input.name.trim()).length > 150) throw new AppError(400, 'name is required and must be at most 150 characters.');
  timeValue(input.start_time, 'start_time');
  timeValue(input.end_time, 'end_time');
  if (input.break_start != null) timeValue(input.break_start, 'break_start');
  if (input.break_end != null) timeValue(input.break_end, 'break_end');
  if (input.break_start == null && input.break_end == null) input = {...input,break_start:null,break_end:null};
  try { timeline('2026-01-01',input); } catch(e) { throw new AppError(400,e.message); }
  const days = input.working_days === undefined ? [1, 2, 3, 4, 5] : input.working_days;
  if (!Array.isArray(days) || !days.length || !Array.from(days).every(day => Number.isInteger(day) && day >= 1 && day <= 7)) throw new AppError(400, 'working_days must be a non-empty array of integers from 1 to 7.');
  if (new Set(days).size !== days.length) throw new AppError(400, 'working_days must not contain duplicates.');
  const status = input.status === undefined ? 'ACTIVE' : input.status;
  if (!['ACTIVE', 'INACTIVE'].includes(status)) throw new AppError(400, 'status must be ACTIVE or INACTIVE.');
  const result = { name: input.name.trim(), start_time: input.start_time, end_time: input.end_time, break_start: input.break_start, break_end: input.break_end, working_days: [...days], status };
  if(input.shift_type!==undefined) {
    if(input.shift_type!==null&&(typeof input.shift_type!=='string'||!/^[A-Za-z0-9_-]{1,50}$/.test(input.shift_type)))throw new AppError(400,'shift_type must be null or 1–50 letters, digits, underscores or hyphens.');
    result.shift_type=input.shift_type;
  }
  if(input.attendance_policy!==undefined)result.attendance_policy=policy(input.attendance_policy);
  return result;
}
module.exports = { validateCreateScheduleInput };

function validateScheduleId(value) {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value) || Number(value) > 2147483647) {
    throw new AppError(400, 'Schedule id must be a positive integer, at most 2147483647.');
  }
  return Number(value);
}

function validateSchedulePatch(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || !Object.keys(input).length) {
    throw new AppError(400, 'Provide at least one field to update.');
  }
  const allowed = new Set(['name', 'start_time', 'end_time', 'break_start', 'break_end', 'working_days', 'status', 'shift_type', 'attendance_policy']);
  if (Object.keys(input).some(key => !allowed.has(key))) {
    throw new AppError(400, 'Only schedule fields, shift_type and attendance_policy can be updated.');
  }
  return input;
}

function prepareScheduleUpdate(existing, assigned, patch) {
  if ((existing.is_default || assigned) && Object.keys(patch).some(key => !['name','shift_type','attendance_policy'].includes(key))) {
    throw new AppError(409, 'Only name, shift_type and attendance_policy can be updated for default schedules or schedules with assignment history.');
  }
  const { id, is_default, ...current } = existing;
  const validated = validateCreateScheduleInput({ ...current, ...patch });
  return Object.fromEntries(Object.keys(patch).map(key => [key, validated[key]]));
}
module.exports.validateScheduleId = validateScheduleId;
module.exports.validateSchedulePatch = validateSchedulePatch;
module.exports.prepareScheduleUpdate = prepareScheduleUpdate;
function validateCurrentAssignment(input){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length!==1||!Number.isInteger(input.work_schedule_id)||input.work_schedule_id<1||input.work_schedule_id>2147483647)throw new AppError(400,'Provide only work_schedule_id (positive integer). Assignments take effect immediately; date ranges are unsupported.');
 return {work_schedule_id:input.work_schedule_id};
}
module.exports.validateAssignmentInput = validateCurrentAssignment;

module.exports.validateCreateIndividual=function(input){
 if(!input||typeof input!=='object'||Array.isArray(input))throw new AppError(400,'Request body must be an object.');
 const {employee_id,...fields}=input;
 if(!Number.isInteger(employee_id)||employee_id<1||employee_id>2147483647)throw new AppError(400,'employee_id must be a positive integer.');
 return {schedule:validateCreateScheduleInput(fields),employeeId:employee_id,assignment:null};
};
