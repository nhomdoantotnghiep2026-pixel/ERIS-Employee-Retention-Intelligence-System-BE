const { AppError } = require('../../common/errors/app-error');

function normalizeExperienceDate(value, field, { nullable = false } = {}) {
  if (nullable && (value === undefined || value === null || value === '')) return null;
  if (typeof value !== 'string') throw new AppError(400, `${field} phải có dạng YYYY-MM-DD, YYYY-MM hoặc MM/YYYY.`);
  let date = value.trim();
  if (/^\d{4}-\d{2}$/.test(date)) date += '-01';
  else if (/^\d{2}\/\d{4}$/.test(date)) date = `${date.slice(3)}-${date.slice(0, 2)}-01`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new AppError(400, `${field} phải có dạng YYYY-MM-DD, YYYY-MM hoặc MM/YYYY.`);
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date || Number(date.slice(0, 4)) < 1900) {
    throw new AppError(400, `${field} không phải ngày hợp lệ từ năm 1900.`);
  }
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const part = type => parts.find(p => p.type === type).value;
  const today = `${part('year')}-${part('month')}-${part('day')}`;
  if (date > today) throw new AppError(400, `${field} không được ở tương lai.`);
  return date;
}

function validateWorkExperience(input, dateOfBirth) {
  const fields = ['companyName', 'positionTitle', 'startDate', 'endDate'];
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !fields.includes(k))) {
    throw new AppError(400, 'Kinh nghiệm chỉ nhận companyName, positionTitle, startDate, endDate.');
  }
  const result = {};
  for (const field of ['companyName', 'positionTitle']) {
    if (typeof input[field] !== 'string' || !input[field].trim() || [...input[field].trim()].length > 150 || /[\u0000-\u001f\u007f]/.test(input[field])) {
      throw new AppError(400, `${field} bắt buộc, tối đa 150 ký tự và không có ký tự điều khiển.`);
    }
    result[field] = input[field].trim();
  }
  result.startDate = normalizeExperienceDate(input.startDate, 'startDate');
  result.endDate = normalizeExperienceDate(input.endDate, 'endDate', { nullable: true });
  if (result.endDate && result.endDate < result.startDate) throw new AppError(400, 'endDate không được trước startDate.');
  if (dateOfBirth && result.startDate <= dateOfBirth) throw new AppError(400, 'startDate của kinh nghiệm phải sau ngày sinh.');
  return result;
}

function validateWorkExperiences(value, dateOfBirth) {
  if (!Array.isArray(value) || value.length > 50) throw new AppError(400, 'workExperiences bắt buộc là mảng tối đa 50 bản ghi; dùng [] nếu chưa có kinh nghiệm.');
  const seen = new Set();
  return value.map((entry, index) => {
    try {
      const record = validateWorkExperience(entry, dateOfBirth);
      const key = JSON.stringify([record.companyName.toLowerCase(), record.positionTitle.toLowerCase(), record.startDate, record.endDate]);
      if (seen.has(key)) throw new AppError(400, 'Kinh nghiệm bị trùng trong cùng hồ sơ.');
      seen.add(key);
      return record;
    } catch (error) {
      throw new AppError(error.statusCode || 400, `workExperiences[${index}]: ${error.message}`);
    }
  });
}

module.exports = { normalizeExperienceDate, validateWorkExperience, validateWorkExperiences };
