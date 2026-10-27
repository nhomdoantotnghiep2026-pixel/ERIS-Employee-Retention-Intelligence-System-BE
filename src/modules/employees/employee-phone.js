const { AppError } = require('../../common/errors/app-error');

function normalizePhone(value) {
  if (typeof value !== 'string' || value.trim().length > 30) throw new AppError(400, 'phone phải là chuỗi số điện thoại tối đa 30 ký tự.');
  let compact = value.trim().replace(/[\s().-]/g, '');
  if (compact.startsWith('00')) compact = '+' + compact.slice(2);
  if (!/^\+?\d{8,15}$/.test(compact)) throw new AppError(400, 'phone phải có 8–15 chữ số; chỉ được thêm dấu + đầu số, khoảng trắng, dấu chấm, gạch nối hoặc ngoặc.');
  const digits = compact.replace(/^\+/, '');
  if (/^84\d{9,10}$/.test(digits)) return '0' + digits.slice(2).replace(/^0/, '');
  return compact;
}

const phoneKey = value => normalizePhone(value).replace(/^\+/, '');
// Normalize legacy values in SQL too, without modifying existing rows or adding database objects.
const digits = "regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g')";
const international = `(CASE WHEN ${digits} LIKE '00%' THEN substr(${digits},3) ELSE ${digits} END)`;
const phoneKeySql = `(CASE WHEN ${international} ~ '^84[0-9]{9,10}$'
  THEN '0' || regexp_replace(substr(${international},3), '^0', '') ELSE ${international} END)`;

module.exports = { normalizePhone, phoneKey, phoneKeySql };
