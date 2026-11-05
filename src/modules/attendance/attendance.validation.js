const { AppError } = require('../../common/errors/app-error');
function validateAttendanceId(value) {
  if (typeof value !== 'string' || !/^[1-9]\d{0,18}$/.test(value) || BigInt(value) > 9223372036854775807n) {
    throw new AppError(400, 'id must be a positive integer.');
  }
  return value;
}
function validateLeaveId(value) {
  if (typeof value !== 'string' || !/^[1-9]\d{0,9}$/.test(value) || Number(value)>2147483647) {
    throw new AppError(400, 'ID đơn nghỉ phải là số nguyên dương hợp lệ.');
  }
  return Number(value);
}
function validateLeaveDecision(body) {
  if (!body || typeof body!=='object' || Array.isArray(body)
    || Object.keys(body).some(key=>!['decision','reviewNote'].includes(key))
    || !['APPROVED','REJECTED'].includes(body.decision)) {
    throw new AppError(400, 'decision phải là APPROVED hoặc REJECTED; chỉ nhận thêm reviewNote.');
  }
  if (body.reviewNote!==undefined && (typeof body.reviewNote!=='string' || body.reviewNote.trim().length>500)) {
    throw new AppError(400, 'reviewNote phải là chuỗi tối đa 500 ký tự.');
  }
  return {decision:body.decision,reviewNote:body.reviewNote?.trim() || null};
}
function validateCancellation(body) {
  if (!body || typeof body!=='object' || Array.isArray(body) || Object.keys(body).some(key=>key!=='reason')
    || typeof body.reason!=='string' || !body.reason.trim() || body.reason.trim().length>500) {
    throw new AppError(400, 'Lý do xin hủy bắt buộc và tối đa 500 ký tự.');
  }
  return body.reason.trim();
}
module.exports = { validateAttendanceId, validateLeaveId, validateLeaveDecision, validateCancellation };
