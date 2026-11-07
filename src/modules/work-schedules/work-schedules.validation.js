const { AppError } = require('../../common/errors/app-error');
function timeValue(value, field) {
  if (typeof value !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,6})?)?$/.test(value)) throw new AppError(400, `${field} must be a valid time (HH:mm or HH:mm:ss, with optional fractional seconds).`);
  const [h, m, s = '0'] = value.split(':');
  return Number(h) * 3600 + Number(m) * 60 + Number(s);
}
function validateCreateScheduleInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AppError(400, 'Request body must be an object.');
  const allowed = new Set(['name', 'start_time', 'end_time', 'break_start', 'break_end', 'working_days', 'status']);
  if (Object.keys(input).some(key => !allowed.has(key))) throw new AppError(400, 'Only name, start_time, end_time, break_start, break_end, working_days, and status are allowed.');
  if (typeof input.name !== 'string' || !input.name.trim() || Array.from(input.name.trim()).length > 150) throw new AppError(400, 'name is required and must be at most 150 characters.');
  const start = timeValue(input.start_time, 'start_time');
  const breakStart = timeValue(input.break_start, 'break_start');
  const breakEnd = timeValue(input.break_end, 'break_end');
  const end = timeValue(input.end_time, 'end_time');
  if (!(start < breakStart && breakStart < breakEnd && breakEnd < end)) throw new AppError(400, 'Times must satisfy start_time < break_start < break_end < end_time.');
  const days = input.working_days === undefined ? [1, 2, 3, 4, 5] : input.working_days;
  if (!Array.isArray(days) || !days.length || !Array.from(days).every(day => Number.isInteger(day) && day >= 1 && day <= 7)) throw new AppError(400, 'working_days must be a non-empty array of integers from 1 to 7.');
  const status = input.status === undefined ? 'ACTIVE' : input.status;
  if (!['ACTIVE', 'INACTIVE'].includes(status)) throw new AppError(400, 'status must be ACTIVE or INACTIVE.');
  return { name: input.name.trim(), start_time: input.start_time, end_time: input.end_time, break_start: input.break_start, break_end: input.break_end, working_days: [...days], status };
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
  const allowed = new Set(['name', 'start_time', 'end_time', 'break_start', 'break_end', 'working_days', 'status']);
  if (Object.keys(input).some(key => !allowed.has(key))) {
    throw new AppError(400, 'Only name, start_time, end_time, break_start, break_end, working_days, and status can be updated.');
  }
  return input;
}

function prepareScheduleUpdate(existing, assigned, patch) {
  if ((existing.is_default || assigned) && Object.keys(patch).some(key => key !== 'name')) {
    throw new AppError(409, 'Only name can be updated for a default schedule or a schedule with assignment history.');
  }
  const { id, is_default, ...current } = existing;
  const validated = validateCreateScheduleInput({ ...current, ...patch });
  return Object.fromEntries(Object.keys(patch).map(key => [key, validated[key]]));
}
module.exports.validateScheduleId = validateScheduleId;
module.exports.validateSchedulePatch = validateSchedulePatch;
module.exports.prepareScheduleUpdate = prepareScheduleUpdate;
function validateAssignmentInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['schedule_id', 'effective_from', 'effective_to'].includes(key))) {
    throw new AppError(400, 'Only schedule_id, effective_from, and effective_to are allowed.');
  }
  if (!Number.isInteger(input.schedule_id) || input.schedule_id < 1 || input.schedule_id > 2147483647) throw new AppError(400, 'schedule_id must be a positive integer.');
  function validDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return false;
    const parsed = new Date(value + 'T00:00:00Z');
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }
  if (!validDate(input.effective_from)) throw new AppError(400, 'effective_from must be a valid YYYY-MM-DD date.');
  const end = input.effective_to === undefined ? null : input.effective_to;
  if (end !== null && (!validDate(end) || end < input.effective_from)) throw new AppError(400, 'effective_to must be null or a valid date on or after effective_from.');
  return { schedule_id: input.schedule_id, effective_from: input.effective_from, effective_to: end };
}
module.exports.validateAssignmentInput = validateAssignmentInput;
