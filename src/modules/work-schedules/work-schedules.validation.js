const {normalizeShiftType}=require('../../common/validation/shift-type');
const { AppError } = require('../../common/errors/app-error');
function timeValue(value, field) {
  if (typeof value !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,6})?)?$/.test(value)) throw new AppError(400, `${field} must be a valid time (HH:mm or HH:mm:ss, with optional fractional seconds).`);
  const [h, m, s = '0'] = value.split(':');
  return Number(h) * 3600 + Number(m) * 60 + Number(s);
}
function validateCreateScheduleInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AppError(400, 'Request body must be an object.');
  const allowed = new Set(['name', 'start_time', 'end_time', 'break_start', 'break_end', 'working_days', 'status', 'shift_type']);
  if (Object.keys(input).some(key => !allowed.has(key))) throw new AppError(400, 'Only name, shift_type, start_time, end_time, break_start, break_end, working_days and status are allowed.');
  if (typeof input.name !== 'string' || !input.name.trim() || Array.from(input.name.trim()).length > 150) throw new AppError(400, 'name is required and must be at most 150 characters.');
  const start=timeValue(input.start_time,'start_time'),end=timeValue(input.end_time,'end_time');
  if(start>=end)throw new AppError(400,'start_time must be before end_time. Overnight shifts are not supported by this schedule contract.');
  if((input.break_start==null)!==(input.break_end==null))throw new AppError(400,'Provide both break_start and break_end, or leave both null.');
  if(input.break_start==null)input={...input,break_start:null,break_end:null};
  else {
    const begin=timeValue(input.break_start,'break_start'),finish=timeValue(input.break_end,'break_end');
    if(!(start<begin&&begin<finish&&finish<end))throw new AppError(400,'Break times must satisfy start_time < break_start < break_end < end_time.');
  }
  const days = input.working_days === undefined ? [1, 2, 3, 4, 5] : input.working_days;
  if (!Array.isArray(days) || !days.length || !Array.from(days).every(day => Number.isInteger(day) && day >= 1 && day <= 7)) throw new AppError(400, 'working_days must be a non-empty array of integers from 1 to 7.');
  if (new Set(days).size !== days.length) throw new AppError(400, 'working_days must not contain duplicates.');
  const status = input.status === undefined ? 'ACTIVE' : input.status;
  if (!['ACTIVE', 'INACTIVE'].includes(status)) throw new AppError(400, 'status must be ACTIVE or INACTIVE.');
  const result = { name: input.name.trim(), start_time: input.start_time, end_time: input.end_time, break_start: input.break_start, break_end: input.break_end, working_days: [...days], status };
  result.shift_type=normalizeShiftType(input.shift_type);
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
  const allowed = new Set(['name', 'start_time', 'end_time', 'break_start', 'break_end', 'working_days', 'status', 'shift_type']);
  if (Object.keys(input).some(key => !allowed.has(key))) {
    throw new AppError(400, 'Only name, shift_type, start_time, end_time, break_start, break_end, working_days and status can be updated.');
  }
  return input;
}

function prepareScheduleUpdate(existing, _assigned, patch) {
  const keys=['name','shift_type','start_time','end_time','break_start','break_end','working_days','status'];
  const current=Object.fromEntries(keys.filter(k=>existing[k]!==undefined).map(k=>[k,existing[k]]));
  const validated=validateCreateScheduleInput({...current,...patch});
  return Object.fromEntries(Object.keys(patch).map(key=>[key,validated[key]]));
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
