const { AppError } = require('../../common/errors/app-error');
const zone = 'Asia/Ho_Chi_Minh';
function todayInVietnam(now = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: zone,
    year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now).map(part => [part.type, part.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
function validDate(value, field) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new AppError(400, `${field} phải là ngày YYYY-MM-DD.`);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new AppError(400, `${field} không hợp lệ.`);
  return value;
}
function datesBetween(fromDate, toDate, maxDays = 30) {
  validDate(fromDate, 'fromDate'); validDate(toDate, 'toDate');
  const start = Date.parse(`${fromDate}T00:00:00Z`), end = Date.parse(`${toDate}T00:00:00Z`);
  const count = (end - start) / 86400000 + 1;
  if (count < 1 || count > maxDays) throw new AppError(400, `Khoảng nghỉ phải từ 1 đến ${maxDays} ngày dương lịch.`);
  return Array.from({ length: count }, (_, index) => new Date(start + index * 86400000).toISOString().slice(0, 10));
}
function isWeekday(date) { const day = new Date(`${date}T00:00:00Z`).getUTCDay(); return day !== 0 && day !== 6; }
function validateLeave(body, now = new Date()) {
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body).some(key => !['fromDate', 'toDate', 'reason'].includes(key))) throw new AppError(400, 'Chỉ nhận fromDate, toDate và reason.');
  const dates = datesBetween(body.fromDate, body.toDate);
  if (body.fromDate <= todayInVietnam(now)) throw new AppError(400, 'Ngày bắt đầu nghỉ phải ở tương lai theo giờ Việt Nam.');
  if (!dates.some(isWeekday)) throw new AppError(400, 'Đơn nghỉ phải có ít nhất một ngày làm việc.');
  if (typeof body.reason !== 'string' || !body.reason.trim() || body.reason.trim().length > 500) throw new AppError(400, 'Lý do nghỉ bắt buộc, tối đa 500 ký tự.');
  return { fromDate: body.fromDate, toDate: body.toDate, reason: body.reason.trim(), dates };
}
function validateHoliday(body, now = new Date()) {
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body).some(key => !['date', 'name'].includes(key))) throw new AppError(400, 'Chỉ nhận date và name.');
  const date = validDate(body.date, 'date');
  if (date < todayInVietnam(now)) throw new AppError(400, 'Không thể tạo ngày lễ trong quá khứ.');
  if (typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 150) throw new AppError(400, 'Tên ngày lễ bắt buộc, tối đa 150 ký tự.');
  return { date, name: body.name.trim() };
}
const HOLIDAYS = 'eris:attendance:holidays:v1';
class AttendanceCalendarStore {
  constructor({ redisClient, ensureRedisConnection }) { this.redis = redisClient; this.connect = ensureRedisConnection; }
  async run(action) {
    try { await this.connect(); return await action(); }
    catch (error) { if (error instanceof AppError) throw error; throw new AppError(503, 'Không truy cập được lịch chấm công trong Redis.'); }
  }
  holiday(date) { return this.run(async () => { const raw = await this.redis.hget(HOLIDAYS, date); return raw ? JSON.parse(raw) : null; }); }
  holidays() { return this.run(async () => Object.values(await this.redis.hgetall(HOLIDAYS)).map(JSON.parse).sort((a, b) => a.date.localeCompare(b.date))); }
  addHoliday(holiday) { return this.run(async () => this.redis.hsetnx(HOLIDAYS, holiday.date, JSON.stringify(holiday))); }
  removeHoliday(date) { return this.run(async () => this.redis.hdel(HOLIDAYS, date)); }
}
module.exports = { AttendanceCalendarStore, todayInVietnam, validDate, datesBetween, isWeekday, validateLeave, validateHoliday };
