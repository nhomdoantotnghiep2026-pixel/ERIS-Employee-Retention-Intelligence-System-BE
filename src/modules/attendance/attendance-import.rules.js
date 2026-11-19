const { createHash } = require('node:crypto');
const { AppError } = require('../../common/errors/app-error');
const MINUTE = 60000, DAY = 86400000;
const CALCULATION_VERSION = 'excel-v2';
const ABSENCE_WAIT_MINUTES = 60;
const DEFAULT_POLICY = Object.freeze({ early_arrival_minutes: 240, late_arrival_minutes: 480,
  early_departure_minutes: 480, late_departure_minutes: 480, unusual_duration_minutes: 960, max_duration_minutes: 1440 });
function fail(code, message, status = 400) { const e = new AppError(status, message); e.code = code; throw e; }
function date(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '1900-01-01') fail('VALIDATION_ERROR', 'Expected a valid YYYY-MM-DD date (1900 or later).');
  const ms = Date.parse(value + 'T00:00:00Z');
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== value) fail('VALIDATION_ERROR', 'Invalid calendar date.');
  return value;
}
function timestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2} [0-2]\d:[0-5]\d:[0-5]\d$/.test(value) || Number(value.slice(11,13)) > 23) fail('ATT-005', 'Datetime must be YYYY-MM-DD HH:mm:ss.');
  try { date(value.slice(0,10)); } catch { fail('ATT-005', 'Invalid calendar date.'); }
  return value.replace(' ', 'T') + '+07:00';
}
const dayOf = ms => new Date(ms + 7 * 60 * MINUTE).toISOString().slice(0,10);
const at = (d, t) => Date.parse(`${d}T${t}+07:00`);
const shiftDay = (d, offset) => new Date(Date.parse(d + 'T00:00:00Z') + offset * DAY).toISOString().slice(0,10);
function policy(input = DEFAULT_POLICY) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !(k in DEFAULT_POLICY))) fail('VALIDATION_ERROR', 'Invalid attendance policy.');
  const p = { ...DEFAULT_POLICY, ...input };
  for (const [key, value] of Object.entries(p)) if (!Number.isInteger(value) || value < 0 || value > 2880) fail('VALIDATION_ERROR', `${key} must be an integer from 0 to 2880.`);
  if (p.max_duration_minutes < 1 || p.unusual_duration_minutes > p.max_duration_minutes) fail('VALIDATION_ERROR', 'Invalid duration thresholds.');
  return p;
}
function scheduleSnapshot(s) {
  return { id: s.id, shift_type: s.shift_type, start_time: s.start_time, end_time: s.end_time,
    break_start: s.break_start, break_end: s.break_end, working_days: s.working_days, status: s.status,
    attendance_policy: policy(s.attendance_policy) };
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  return value;
}
const hash = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
function timeline(d, s) {
  date(d);
  const start = at(d, s.start_time); let end = at(d, s.end_time);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start === end) fail('ATT-010', 'Invalid schedule times.');
  if (end < start) end += DAY;
  let breakStart = null, breakEnd = null;
  if (s.break_start != null || s.break_end != null) {
    if (!s.break_start || !s.break_end || s.break_start === s.break_end) fail('ATT-010', 'Invalid break configuration.');
    breakStart = at(d, s.break_start); if (breakStart < start) breakStart += DAY;
    breakEnd = at(dayOf(breakStart), s.break_end); if (breakEnd < breakStart) breakEnd += DAY;
    if (!Number.isFinite(breakStart) || !Number.isFinite(breakEnd) || breakStart < start || breakEnd > end || breakEnd <= breakStart) fail('ATT-010', 'Break must fit within the shift.');
  }
  return { start, end, breakStart, breakEnd };
}
const overlap = (a,b,c,d) => c == null ? 0 : Math.max(0, Math.min(b,d) - Math.max(a,c));
function calculate(d, checkIn, checkOut, s) {
  const a = Date.parse(checkIn), b = Date.parse(checkOut), t = timeline(d,s);
  if (!Number.isFinite(a) || !Number.isFinite(b)) fail('ATT-005', 'Invalid datetime.');
  if (b <= a) fail('ATT-006', 'check_out must be after check_in.');
  const outside = Math.max(0, Math.min(b,t.start)-a) + Math.max(0,b-Math.max(a,t.end));
  const late = Math.floor(Math.max(0,a-t.start)/MINUTE);
  const early = Math.floor(Math.max(0,t.end-b)/MINUTE);
  const status = late ? (early ? 'LATE_EARLY_LEAVE' : 'LATE') : (early ? 'EARLY_LEAVE' : 'PRESENT');
  return { working_minutes: Math.floor((b-a-overlap(a,b,t.breakStart,t.breakEnd))/MINUTE),
    late_mins: late, early_mins: early,
    outside_shift_minutes: Math.floor(outside/MINUTE), overtime_minutes: Math.floor((Math.max(0,b-Math.max(a,t.end))-overlap(Math.max(a,t.end),b,t.breakStart,t.breakEnd))/MINUTE), attendance_status: status };
}
function isWorkingDay(workDate, schedule) {
  return (schedule.working_days || []).includes(new Date(workDate + 'T00:00:00Z').getUTCDay() || 7);
}
function classifyNoPunch(workDate, schedule, now, { holiday, leave, complete }) {
  const end = timeline(workDate, schedule).end;
  if (end > now) return null;
  if (holiday) return 'HOLIDAY';
  if (!isWorkingDay(workDate, schedule)) return 'DAY_OFF';
  if (leave) return 'ON_LEAVE';
  if (complete && now >= end + ABSENCE_WAIT_MINUTES * MINUTE) return 'ABSENT';
  return null;
}
function candidates(checkIn, checkOut, s) {
  const a = Date.parse(checkIn), b = Date.parse(checkOut), p = policy(s.attendance_policy);
  const result = [], extent = Math.ceil(Math.max(p.early_arrival_minutes,p.late_arrival_minutes) / 1440) + 1;
  for (let offset = -extent; offset <= extent; offset++) {
    const d = shiftDay(dayOf(a),offset), t = timeline(d,s);
    if (a >= t.start-p.early_arrival_minutes*MINUTE && a <= t.start+p.late_arrival_minutes*MINUTE
      && b >= t.end-p.early_departure_minutes*MINUTE && b <= t.end+p.late_departure_minutes*MINUTE) result.push(d);
  }
  return result;
}
function reason(value) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 1000) fail('VALIDATION_ERROR', 'A reason of 1–1000 characters is required.');
  return value.trim();
}
function id(value) {
  if ((typeof value==='number'&&!Number.isSafeInteger(value)) || !/^[1-9]\d{0,18}$/.test(String(value)) || BigInt(value)>9223372036854775807n) fail('VALIDATION_ERROR', 'Invalid positive ID.');
  return String(value);
}
function object(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !keys.includes(k))) fail('VALIDATION_ERROR', `Only ${keys.join(', ')} are accepted.`);
}
module.exports = { CALCULATION_VERSION, DEFAULT_POLICY, MINUTE, date, timestamp, policy, scheduleSnapshot,
  hash, timeline, calculate, candidates, isWorkingDay, classifyNoPunch, reason, id, object, fail };
