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
  if (typeof body.reason !== 'string' || !body.reason.trim() || body.reason.trim().length > 500) throw new AppError(400, 'Lý do nghỉ bắt buộc, tối đa 500 ký tự.');
  return { fromDate: body.fromDate, toDate: body.toDate, reason: body.reason.trim(), dates };
}
function validateHoliday(body, now = new Date()) {
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body).some(key => !['start_date', 'end_date', 'name'].includes(key))) throw new AppError(400, 'Chỉ nhận start_date, end_date và name.');
  const start_date = validDate(body.start_date, 'start_date');
  const end_date = validDate(body.end_date, 'end_date');
  if (start_date < todayInVietnam(now)) throw new AppError(400, 'Không thể tạo ngày lễ trong quá khứ.');
  if (end_date < start_date) throw new AppError(400, 'end_date phải lớn hơn hoặc bằng start_date.');
  if (typeof body.name !== 'string' || !body.name.trim() || Array.from(body.name.trim()).length > 150) throw new AppError(400, 'Tên ngày lễ bắt buộc, tối đa 150 ký tự.');
  return { start_date, end_date, name: body.name.trim() };
}
const { transaction } = require('../audit_logs/audit.repository');
const { AttendanceRepository } = require('./attendance.repository');
const columns = 'id, name, start_date::text, end_date::text, created_by, created_at, updated_at';
class AttendanceCalendarStore {
  constructor({ databasePool }) { this.pool = databasePool; }
  async holiday(date) {
    const { rows } = await this.pool.query(`SELECT ${columns} FROM holidays WHERE start_date <= $1::date AND end_date >= $1::date LIMIT 1`, [date]);
    return rows[0] || null;
  }
  async holidays() {
    const { rows } = await this.pool.query(`SELECT ${columns} FROM holidays ORDER BY start_date ASC, id ASC`);
    return rows;
  }
  async createHoliday(input, actorId, today) {
    try {
      return await transaction(this.pool, async client => {
        const { rows } = await client.query(
          `INSERT INTO holidays (name, start_date, end_date, created_by) VALUES ($1, $2, $3, $4) RETURNING ${columns}`,
          [input.name, input.start_date, input.end_date, actorId]);
        const affectedEmployees = input.start_date <= today && today <= input.end_date
          ? await new AttendanceRepository(client).markHoliday(today, client) : 0;
        return { data: rows[0], affectedEmployees };
      });
    } catch (cause) {
      if (cause.code === '23P01') {
        const error = new AppError(409, 'Khoảng nghỉ lễ chồng lấn với ngày lễ đã tồn tại.');
        error.code = 'HOLIDAY_EXISTS'; throw error;
      }
      throw cause;
    }
  }
}
module.exports = { AttendanceCalendarStore, todayInVietnam, validDate, datesBetween, isWeekday, validateLeave, validateHoliday };
