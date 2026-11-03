const fs = require('node:fs');
const path = require('node:path');
const { app } = require('../src/app');
const { databasePool: pool } = require('../src/config/database');
const { redisClient } = require('../src/config/redis');
const dir = path.join(__dirname, '../docs');
const previous = JSON.parse(fs.readFileSync(path.join(dir, 'api-test-results.json'), 'utf8'));
const results = previous.results;
let server, base;
const created = [];
function sanitized(value) {
  if (Array.isArray(value)) return value.map(sanitized);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, /password|token|cookie|otp/i.test(key) ? '<redacted>' : sanitized(child)]));
  return value;
}
async function check(module, label, method, url, expected, token, body, verify) {
  const response = await fetch(base + url, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) });
  const data = await response.json();
  const passed = response.status === expected && (!verify || verify(data));
  results.push({ module, label, method, url, expected, actual: response.status, passed, request: body ? sanitized(body) : undefined, responseKeys: Object.keys(data), message: data.message || 'Response shape verified' });
  console.log(`${passed ? 'PASS' : 'FAIL'} ${module}: ${label} (${response.status}/${expected})`);
  return data;
}
async function main() {
  server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve)); base = `http://127.0.0.1:${server.address().port}`;
  const login = async (email, password) => {
    const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
    const d = await r.json(); if (!d.accessToken) throw new Error('Login prerequisite failed'); return d.accessToken;
  };
  const admin = await login(process.env.TEST_ADMIN_EMAIL, process.env.TEST_ADMIN_PASSWORD);
  const hr = await login(process.env.TEST_HR_EMAIL, process.env.TEST_HR_PASSWORD);
  const suffix = Date.now();
  const missing = 2147483647;
  for (const [module, url] of [['departments','/api/departments'],['positions','/api/positions']]) {
    await check(module, 'Admin forbidden', 'GET', url, 403, admin);
    await check(module, 'Create missing fields', 'POST', url, 400, hr, {});
    await check(module, 'Update invalid ID', 'PATCH', url + '/abc', 400, hr, { name: 'invalid' });
    await check(module, 'Update missing record', 'PATCH', `${url}/${missing}`, 404, hr, { name: 'missing' });
    const input = { name: `API TEST ${module} ${suffix}`, description: 'Temporary integration test', ...(module === 'positions' ? { jobLevel: 2, departmentId: created.find(record => record.table === 'departments')?.id } : {}) };
    const saved = await check(module, 'Create valid record', 'POST', url, 201, hr, input, d => Boolean(d.data?.id));
    if (saved.data?.id) {
      const id = saved.data.id; created.push({ table: module, id });
      await check(module, 'Update created record', 'PATCH', `${url}/${id}`, 200, hr, { description: 'Updated by API test' }, d => d.data?.description === 'Updated by API test');
      if (module === 'positions') await check(module, 'Read created record', 'GET', `${url}/${id}`, 200, hr, undefined, d => d.data?.id === id);
      await check(module, 'Deactivate created record', 'DELETE', `${url}/${id}`, 200, hr, undefined, d => d.data?.status === 'INACTIVE');
      await check(module, 'Deactivate already inactive', 'DELETE', `${url}/${id}`, 409, hr);
    }
  }
  await check('positions', 'Invalid department filter', 'GET', '/api/positions?departmentId=abc', 400, hr);
  await check('positions', 'Filter by absent department', 'GET', `/api/positions?departmentId=${missing}`, 200, hr);
  await check('employees', 'Admin cannot list employees', 'GET', '/api/employees', 403, admin);
  await check('employees', 'Create missing fields', 'POST', '/api/employees', 400, hr, {});
  await check('employees', 'Read missing employee', 'GET', `/api/employees/${missing}`, 404, hr);
  await check('employees', 'Read invalid ID', 'GET', '/api/employees/abc', 400, hr);
  await check('employees', 'HR without own employee profile', 'GET', '/api/employees/me', 404, hr);
  await check('employees', 'Reject immutable email update', 'PATCH', `/api/employees/${missing}`, 400, hr, { email: 'new@example.invalid' });
  await check('users', 'Get own HR as admin', 'GET', '/api/users/2', 200, admin);
  await check('users', 'Missing user', 'GET', `/api/users/${missing}`, 404, admin);
  await check('users', 'Invalid user ID', 'GET', '/api/users/abc', 400, admin);
  await check('users', 'HR cannot change status', 'PATCH', '/api/users/1/status', 403, hr, { status: 'INACTIVE' });
  await check('users', 'Invalid status', 'PATCH', '/api/users/2/status', 400, admin, { status: 'INVALID' });
  await check('surveys', 'Admin cannot list surveys', 'GET', '/api/surveys', 403, admin);
  await check('surveys', 'Create missing title', 'POST', '/api/surveys', 400, hr, {});
  await check('surveys', 'Create invalid date range', 'POST', '/api/surveys', 400, hr, { title: 'invalid dates', startDate: '2026-12-02', endDate: '2026-12-01' });
  const survey = await check('surveys', 'Create draft with default questions', 'POST', '/api/surveys', 201, hr, { title: `API TEST survey ${suffix}` }, d => d.data?.status === 'DRAFT' && d.data?.questions?.length > 0);
  if (survey.data?.id) {
    const id = survey.data.id; created.push({ table: 'surveys', id });
    await check('surveys', 'Draft participants empty', 'GET', `/api/surveys/${id}/responses`, 200, hr, undefined, d => d.data?.responseCount === 0);
    await check('surveys', 'Publish draft', 'POST', `/api/surveys/${id}/publish`, 200, hr);
    await check('surveys', 'Publish already active', 'POST', `/api/surveys/${id}/publish`, 409, hr);
    await check('surveys', 'Read results', 'GET', `/api/surveys/${id}/results`, 200, hr);
  }
  await check('surveys', 'Missing survey participants', 'GET', `/api/surveys/${missing}/responses`, 404, hr);
  await check('surveys', 'Invalid survey ID', 'GET', '/api/surveys/abc/responses', 400, hr);
  await check('surveys', 'Submit malformed answers', 'POST', '/api/surveys/1/responses', 400, hr, { answers: [{ questionId: 1, score: 5 }] });
  for (const [module, root, child] of [['education','/api/employee-educations','educations'],['work-experiences','/api/employee-work-experiences','work-experiences'],['job-histories','/api/job-histories','job-histories']]) {
    await check(module, 'Admin forbidden', 'GET', root, 403, admin);
    await check(module, 'Missing employee', 'GET', `/api/employees/${missing}/${child}`, 404, hr);
    await check(module, 'Invalid employee ID', 'GET', `/api/employees/abc/${child}`, 400, hr);
  }
  await check('education', 'List active employee options', 'GET', '/api/employee-educations/employees', 200, hr);
  await check('education', 'Invalid institution query', 'GET', '/api/employee-educations/institutions?query=x', 400, hr);
  await check('audit-logs', 'HR forbidden', 'GET', '/api/audit-logs', 403, hr);
  await check('audit-logs', 'Invalid log ID', 'GET', '/api/audit-logs/abc', 400, admin);
  await check('audit-logs', 'Missing log', 'GET', `/api/audit-logs/${missing}`, 404, admin);
  const logs = await check('audit-logs', 'Audit records after CRUD', 'GET', '/api/audit-logs', 200, admin, undefined, d => d.data?.length > 0);
  if (logs.data?.[0]?.id) await check('audit-logs', 'Read audit detail', 'GET', `/api/audit-logs/${logs.data[0].id}`, 200, admin);
  await check('distance', 'Without token', 'GET', '/api/distance/places?query=FPT', 401);
  await check('distance', 'Admin forbidden', 'GET', '/api/distance/places?query=FPT', 403, admin);
  await check('distance', 'Query too short', 'GET', '/api/distance/places?query=x', 400, hr);
  await check('distance', 'Search actual provider', 'GET', '/api/distance/places?query=FPT%20University', 200, hr, undefined, d => Array.isArray(d.places));
}
async function finish(error) {
  for (const { table, id } of created.reverse()) {
    try {
      if (table === 'surveys') await pool.query('DELETE FROM survey_questions WHERE survey_id=$1', [id]);
      if (!['surveys', 'positions', 'departments'].includes(table)) throw new Error('Unexpected cleanup table');
      await pool.query(`DELETE FROM ${table} WHERE id=$1`, [id]);
    } catch (e) { console.error('Cleanup failed', table, id, e.message); }
  }
  fs.writeFileSync(path.join(dir, 'api-test-results.json'), JSON.stringify({ date: '2026-11-03', error: error?.message, results }, null, 2));
  for (const module of new Set(results.map(r => r.module))) {
    const filename = path.join(dir, `${module}-api-test-results.md`);
    const rows = results.filter(r => r.module === module);
    fs.writeFileSync(filename, `# Kết quả test API ${module}\n\nNgày: 2026-11-03 (Asia/Saigon). Gọi HTTP thật qua Express, dùng PostgreSQL/Redis cấu hình trong .env.\n\n| Trường hợp | API | Mong đợi | Thực tế | Kết quả | Phản hồi |\n|---|---|---:|---:|---|---|\n` + rows.map(r => `| ${r.label} | ${r.method} ${r.url} | ${r.expected} | ${r.actual} | ${r.passed ? 'PASS' : 'FAIL'} | ${String(r.message).replace(/\|/g,'/').replace(/\n/g,' ')} |`).join('\n') + '\n\nChi tiết request (đã che thông tin xác thực) và response keys nằm trong [JSON kết quả](./api-test-results.json). Chỉ các case liệt kê đã được chạy.\n' + (module === 'auth' ? '\nSMTP thật đã chấp nhận email. Test giữ OTP trong bộ nhớ để gọi API, không ghi OTP vào file. HR yêu cầu đã ACTIVE; mật khẩu cuối giữ đúng yêu cầu.\n' : ''));
  }
  fs.writeFileSync(path.join(dir, 'api-test-index.md'), '# Kiểm thử API sau cập nhật database\n\nNgày: 2026-11-03.\n\n' + [...new Set(results.map(r => r.module))].map(m => `- [${m}](./${m}-api-test-results.md)`).join('\n') + `\n\n${results.filter(r => r.passed).length}/${results.length} case PASS.\n\nDữ liệu phòng ban/vị trí/khảo sát do test tạo được xóa sau test; audit log giữ lại. Tài khoản HR người dùng yêu cầu được giữ lại.\n\nPhạm vi còn thiếu: tạo/kích hoạt nhân viên có bằng cấp và kinh nghiệm, trả lời khảo sát dưới vai trò EMPLOYEE, chấm công thành công cần hồ sơ ACTIVE. Các API lỗi schema được ghi FAIL, không giả lập thành công.\n` + (error ? `\nLần chạy dừng: ${error.message}\n` : ''));
  require('./render-api-docs.cjs').render();
  if (results.some(result => !result.passed)) process.exitCode = 1;
  if (server) await new Promise(resolve => server.close(resolve)); await pool.end(); redisClient.disconnect();
}
main().then(() => finish()).catch(e => { console.error(e.message); process.exitCode = 1; return finish(e); });
