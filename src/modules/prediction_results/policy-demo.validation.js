const { AppError } = require('../../common/errors/app-error');
function validateDemoInput(body) {
  if (!body || typeof body!=='object' || Array.isArray(body) || Object.keys(body).some(key=>key!=='employeeIds')
    || !Array.isArray(body.employeeIds) || body.employeeIds.length<1 || body.employeeIds.length>100
    || body.employeeIds.some(id=>!Number.isInteger(id)||id<1||id>2147483647)
    || new Set(body.employeeIds).size!==body.employeeIds.length) {
    throw new AppError(400,'Chỉ nhận employeeIds là mảng 1–100 ID số nguyên dương, không trùng nhau.');
  }
  return [...body.employeeIds].sort((a,b)=>a-b);
}
function validatePolicyId(value, int32=false) {
  if (typeof value!=='string' || !/^[1-9]\d{0,18}$/.test(value)
    || BigInt(value)>(int32?2147483647n:9223372036854775807n)) throw new AppError(400,'ID không hợp lệ.');
  return value;
}
module.exports = { validateDemoInput, validatePolicyId };
