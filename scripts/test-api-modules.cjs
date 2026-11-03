// Live integration checks. Credentials come from the process environment, never reports.
const fs = require('node:fs');
const path = require('node:path');
require('../src/config/env');
if (!process.env.TEST_ADMIN_EMAIL || !process.env.TEST_ADMIN_PASSWORD || !process.env.TEST_HR_EMAIL || !process.env.TEST_HR_PASSWORD) throw new Error('Set TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD, TEST_HR_EMAIL, TEST_HR_PASSWORD.');
process.env.INITIAL_USER_PASSWORD = process.env.TEST_HR_PASSWORD;
const { mailTransporter } = require('../src/config/mail');
const sendMail = mailTransporter.sendMail.bind(mailTransporter);
const otps = new Map();
mailTransporter.sendMail = async message => {
  const result = await sendMail(message);
  if (result.rejected?.length || !result.accepted?.length) throw new Error('SMTP did not accept recipient');
  const match = message.text?.match(/Your ERIS OTP is (\d{6})/);
  if (match) otps.set(message.to, match[1]);
  return result;
};
const { app } = require('../src/app');
const { databasePool } = require('../src/config/database');
const { redisClient } = require('../src/config/redis');
const results = [];
let server, base;
async function check(module, label, method, url, expected, { body, token, cookie, verify } = {}) {
  if (url === '/api/auth/user_register' && body) body = { full_name: 'Nguyễn Văn HR', ...body };
  const response = await fetch(base + url, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(45000) });
  const text = await response.text(); let data; try { data = JSON.parse(text); } catch { data = { message: text.slice(0, 200) }; }
  const passed = response.status === expected && (!verify || verify(data, response));
  results.push({ module, label, method, url, expected, actual: response.status, passed, message: data.message || (passed ? 'Response shape verified' : 'Unexpected response') });
  console.log(`${passed ? 'PASS' : 'FAIL'} ${module}: ${label} (${response.status}/${expected})`);
  return { data, cookie: response.headers.get('set-cookie')?.split(';')[0], passed };
}
async function main() {
  server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve)); base = `http://127.0.0.1:${server.address().port}`;
  const loginBody = { email: process.env.TEST_ADMIN_EMAIL, password: process.env.TEST_ADMIN_PASSWORD };
  await check('auth', 'Login missing fields', 'POST', '/api/auth/login', 400, { body: {} });
  await check('auth', 'Login wrong password', 'POST', '/api/auth/login', 401, { body: { ...loginBody, password: 'incorrect-test-password' } });
  const admin = await check('auth', 'Admin login', 'POST', '/api/auth/login', 200, { body: loginBody, verify: d => Boolean(d.accessToken) });
  if (!admin.passed) throw new Error('Admin login failed');
  const token = admin.data.accessToken;
  await check('auth', 'Me without token', 'GET', '/api/auth/me', 401);
  await check('auth', 'Me invalid token', 'GET', '/api/auth/me', 401, { token: 'invalid' });
  await check('auth', 'Me admin', 'GET', '/api/auth/me', 200, { token, verify: d => d.role === 'ADMIN' });
  await check('auth', 'Refresh without cookie', 'POST', '/api/auth/refresh', 401);
  const refreshed = await check('auth', 'Refresh rotates session', 'POST', '/api/auth/refresh', 200, { cookie: admin.cookie, verify: (d, r) => Boolean(d.accessToken && r.headers.get('set-cookie')) });
  await check('auth', 'Refresh old cookie', 'POST', '/api/auth/refresh', 401, { cookie: admin.cookie });
  await check('auth', 'Logout valid session', 'POST', '/api/auth/logout', 200, { cookie: refreshed.cookie });
  await check('auth', 'Refresh after logout', 'POST', '/api/auth/refresh', 401, { cookie: refreshed.cookie });
  await check('auth', 'Logout without cookie', 'POST', '/api/auth/logout', 200);
  await check('auth', 'Register without token', 'POST', '/api/auth/user_register', 401, { body: { email: process.env.TEST_HR_EMAIL } });
  await check('auth', 'Register rejects password field', 'POST', '/api/auth/user_register', 400, { token, body: { email: process.env.TEST_HR_EMAIL, password: 'ignored' } });
  await check('auth', 'Register invalid email', 'POST', '/api/auth/user_register', 400, { token, body: { email: 'invalid' } });
  const existing = (await databasePool.query('SELECT id,status FROM users WHERE lower(email)=lower($1)', [process.env.TEST_HR_EMAIL])).rows[0];
  if (!existing) {
    const created = await check('auth', 'Admin creates requested HR', 'POST', '/api/auth/user_register', 201, { token, body: { email: process.env.TEST_HR_EMAIL }, verify: d => d.data?.role === 'HR' && d.data?.status === 'IN_PROCESS' && d.data?.emailDelivery === 'SENT' });
    if (!created.passed) throw new Error('HR creation or invitation failed; inspect account before retry');
  }
  await check('auth', 'Duplicate HR email', 'POST', '/api/auth/user_register', 409, { token, body: { email: process.env.TEST_HR_EMAIL } });
  const hrBody = { email: process.env.TEST_HR_EMAIL, password: process.env.TEST_HR_PASSWORD };
  let hr = await check('auth', 'HR login with requested password', 'POST', '/api/auth/login', 200, { body: hrBody });
  if (hr.data.passwordChangeToken) {
    const changeToken = hr.data.passwordChangeToken;
    await check('auth', 'Setup token cannot access me', 'GET', '/api/auth/me', 401, { token: changeToken });
    await check('auth', 'Setup rejects malformed OTP', 'PATCH', '/api/auth/change-password', 400, { token: changeToken, body: { otp: 'abc', newPassword: process.env.TEST_HR_PASSWORD } });
    const otp = otps.get(process.env.TEST_HR_EMAIL);
    if (!otp) throw new Error('No SMTP-confirmed setup OTP captured');
    await check('auth', 'HR setup with delivered OTP', 'PATCH', '/api/auth/change-password', 200, { token: changeToken, body: { otp, newPassword: process.env.TEST_HR_PASSWORD } });
    hr = await check('auth', 'Active HR login', 'POST', '/api/auth/login', 200, { body: hrBody, verify: d => Boolean(d.accessToken) });
  }
  const hrToken = hr.data.accessToken;
  if (!hrToken) throw new Error('HR activation failed');
  await check('auth', 'Me HR active', 'GET', '/api/auth/me', 200, { token: hrToken, verify: d => d.role === 'HR' && d.status === 'ACTIVE' });
  await check('auth', 'HR cannot register HR', 'POST', '/api/auth/user_register', 403, { token: hrToken, body: { email: 'forbidden@example.invalid' } });
  await check('auth', 'Change OTP without token', 'POST', '/api/auth/change-password/otp', 401);
  await check('auth', 'Request change OTP', 'POST', '/api/auth/change-password/otp', 200, { token: hrToken });
  const changeOtp = otps.get(process.env.TEST_HR_EMAIL);
  await check('auth', 'Wrong current password', 'PATCH', '/api/auth/change-password', 401, { token: hrToken, body: { currentPassword: 'wrong-password', otp: changeOtp, newPassword: process.env.TEST_HR_PASSWORD } });
  await check('auth', 'Change password delivered OTP', 'PATCH', '/api/auth/change-password', 200, { token: hrToken, body: { currentPassword: process.env.TEST_HR_PASSWORD, otp: changeOtp, newPassword: process.env.TEST_HR_PASSWORD } });
  await check('auth', 'Refresh revoked after password change', 'POST', '/api/auth/refresh', 401, { cookie: hr.cookie });
  await check('auth', 'Forgot invalid email', 'POST', '/api/auth/forgot-password', 400, { body: { email: 'invalid' } });
  await check('auth', 'Forgot unknown email hides existence', 'POST', '/api/auth/forgot-password', 200, { body: { email: 'missing-api-test@example.invalid' } });
  await check('auth', 'Forgot active HR', 'POST', '/api/auth/forgot-password', 200, { body: { email: process.env.TEST_HR_EMAIL } });
  const resetOtp = otps.get(process.env.TEST_HR_EMAIL);
  await check('auth', 'Reset delivered OTP', 'POST', '/api/auth/reset-password', 200, { body: { email: process.env.TEST_HR_EMAIL, otp: resetOtp, newPassword: process.env.TEST_HR_PASSWORD } });
  await check('auth', 'Reset reused OTP', 'POST', '/api/auth/reset-password', 400, { body: { email: process.env.TEST_HR_EMAIL, otp: resetOtp, newPassword: process.env.TEST_HR_PASSWORD } });
  hr = await check('auth', 'Final HR login', 'POST', '/api/auth/login', 200, { body: hrBody, verify: d => Boolean(d.accessToken) });
  const modules = [ ['users','/api/users',token], ['departments','/api/departments',hr.data.accessToken], ['positions','/api/positions',hr.data.accessToken], ['employees','/api/employees',hr.data.accessToken], ['surveys','/api/surveys',hr.data.accessToken], ['education','/api/employee-educations',hr.data.accessToken], ['work-experiences','/api/employee-work-experiences',hr.data.accessToken], ['job-histories','/api/job-histories',hr.data.accessToken], ['audit-logs','/api/audit-logs',token] ];
  for (const [module, url, actor] of modules) {
    await check(module, 'List authorized', 'GET', url, 200, { token: actor });
    await check(module, 'List without token', 'GET', url, 401);
  }
  await check('users', 'HR cannot list accounts', 'GET', '/api/users', 403, { token: hr.data.accessToken });
  await check('attendance', 'Without token', 'GET', '/api/v1/attendance/config', 401);
  await check('attendance', 'HR without employee profile', 'GET', '/api/v1/attendance/config', 403, { token: hr.data.accessToken });
}
function report(error) {
  const dir = path.join(__dirname, '../docs'); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'api-test-results.json'), JSON.stringify({ date: '2026-11-03', error: error?.message, results }, null, 2));
  for (const module of new Set(results.map(r => r.module))) {
    const rows = results.filter(r => r.module === module);
    const text = `# Kết quả test API ${module}\n\nNgày: 2026-11-03 (Asia/Saigon). HTTP thật qua Express, PostgreSQL và Redis cấu hình trong .env. Auth dùng SMTP thật; OTP được giữ trong bộ nhớ sau khi SMTP chấp nhận, không ghi ra tài liệu.\n\n| Trường hợp | API | Mong đợi | Thực tế | Kết quả | Phản hồi |\n|---|---|---:|---:|---|---|\n` + rows.map(r => `| ${r.label} | ${r.method} ${r.url} | ${r.expected} | ${r.actual} | ${r.passed ? 'PASS' : 'FAIL'} | ${String(r.message).replace(/\|/g, '/').replace(/\n/g, ' ')} |`).join('\n') + '\n\n' + (module === 'auth' ? 'Tài khoản HR yêu cầu được giữ lại. Mật khẩu cuối cùng giữ đúng giá trị người dùng yêu cầu. Không lưu mật khẩu, JWT, cookie hay OTP trong báo cáo. SMTP accepted không chứng minh email đã vào inbox.\n' : 'Phạm vi: các trường hợp liệt kê ở trên. Chưa kiểm thử đầy đủ CRUD và các luồng nghiệp vụ của module.\n');
    fs.writeFileSync(path.join(dir, `${module}-api-test-results.md`), text);
  }
  fs.writeFileSync(path.join(dir, 'api-test-index.md'), '# Kiểm thử API sau cập nhật database\n\nNgày 2026-11-03.\n\n' + [...new Set(results.map(r => r.module))].map(m => `- [${m}](./${m}-api-test-results.md)`).join('\n') + `\n\n${results.filter(r => r.passed).length}/${results.length} case PASS.\n` + (error ? `\nLần chạy bị dừng: ${error.message}\n` : '') + '\nCác module ngoài auth mới kiểm thử phạm vi ghi trong từng báo cáo; chưa tuyên bố hoàn tất toàn bộ module.\n');
}
main().then(() => report()).catch(error => { console.error(error.message); report(error); process.exitCode = 1; }).finally(async () => { require('./render-api-docs.cjs').render(); if (server) await new Promise(resolve => server.close(resolve)); await databasePool.end(); redisClient.disconnect(); if (results.some(r => !r.passed)) process.exitCode = 1; });
