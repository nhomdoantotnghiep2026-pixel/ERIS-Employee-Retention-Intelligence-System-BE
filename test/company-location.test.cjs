const assert = require('node:assert/strict');
const test = require('node:test');
const express = require('express');
const { CompanyLocationStore, validateCompanyLocation } = require('../src/modules/attendance/company-location.store');
const { createAttendanceService } = require('../src/modules/attendance/attendance.service');
const { createAttendanceRouter } = require('../src/modules/attendance/attendance.routes');
const hr = { id: 1, status: 'ACTIVE', role_name: 'HR', employeeId: 10, employmentStatus: 'ACTIVE' };
const location = { address: 'Công ty thử nghiệm', latitude: 10.845106259, longitude: 106.838943078 };
const fallback = { address: 'Cấu hình ban đầu', latitude: 10, longitude: 106 };
function fixture() {
  const values = new Map();
  const redisClient = { get: async key => values.get(key) ?? null, set: async (key, value) => { values.set(key, value); return 'OK'; } };
  const store = new CompanyLocationStore({ redisClient, ensureRedisConnection: async () => {}, fallback });
  let writes = 0;
  const service = createAttendanceService({ attendance: { ...fallback, radiusMeters: 100, maxAccuracyMeters: 100 } },
    { record: async () => { writes++; return { id: 9 }; } }, () => new Date('2026-10-29T09:00:00+07:00'), store);
  return { store, service, redisClient, writes: () => writes };
}
test('validate đủ trường, chuẩn hóa địa chỉ và chặn tọa độ sai', () => {
  assert.equal(validateCompanyLocation({ ...location, address: ' A ' }).address, 'A');
  for (const input of [null, [], {}, { ...location, address: '' }, { ...location, latitude: '10' }, { ...location, longitude: 181 }, { ...location, latitude: NaN }, { ...location, radiusMeters: 500 }, { ...location, address: 'a\nb' }]) {
    assert.throws(() => validateCompanyLocation(input), e => e.statusCode === 400);
  }
});
test('Redis lưu không TTL, đọc qua store khác, cấu hình và check-in/out đổi ngay', async () => {
  const f = fixture();
  assert.equal((await f.store.get()).source, 'env');
  const gps = { latitude: location.latitude, longitude: location.longitude, accuracyMeters: 10 };
  assert.equal((await f.service.checkIn(hr, gps)).persisted, false);
  const saved = await f.service.updateCompanyLocation(hr, location);
  assert.equal(saved.data.updatedBy, 1);
  assert.equal(saved.allowedRadiusMeters, 100);
  const second = new CompanyLocationStore({ redisClient: f.redisClient, ensureRedisConnection: async () => {}, fallback });
  assert.equal((await second.get()).source, 'redis');
  assert.equal((await f.service.configuration()).companyLocation.latitude, location.latitude);
  assert.equal((await f.service.checkIn(hr, gps)).persisted, true);
  assert.equal((await f.service.checkOut(hr, gps)).persisted, true);
  assert.equal(f.writes(), 2);
});
test('Redis lỗi/cấu hình hỏng trả 503 và không ghi chấm công', async () => {
  const f = fixture();
  f.redisClient.get = async () => { throw new Error('offline'); };

  await assert.rejects(() => f.service.checkIn(hr, { latitude: 10, longitude: 106, accuracyMeters: 5 }), e => e.statusCode === 503);
  assert.equal(f.writes(), 0);
  f.redisClient.get = async () => '{broken';
  await assert.rejects(() => f.store.get(), e => e.statusCode === 503);
  f.redisClient.set = async () => { throw new Error('offline'); };
  await assert.rejects(() => f.store.set(location, 1), e => e.statusCode === 503);
});
test('HTTP: HR có hồ sơ ACTIVE được cập nhật; HR thiếu ID, nhân viên, hồ sơ inactive bị chặn', async () => {
  const f = fixture();
  const app = express(); app.use(express.json());
  let actor = hr;
  app.use('/api/v1/attendance', createAttendanceRouter({ service: f.service,
    authenticate: (req, _res, next) => { req.auth = { userId: actor.id }; next(); },
    databasePool: { query: async () => ({ rows: [actor] }) } }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const url = `http://127.0.0.1:${server.address().port}/api/v1/attendance/company-location`;
  const put = body => fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    assert.equal((await put(location)).status, 200);
    const read = await fetch(url); assert.equal(read.status, 200);
    assert.equal((await read.json()).data.address, location.address);
    assert.equal((await put({ ...location, address: '' })).status, 400);
    for (const change of [{ employeeId: null }, { role_name: 'EMPLOYEE' }, { employmentStatus: 'IN_PROCESS' }, { employmentStatus: 'INACTIVE' }]) {
      actor = { ...hr, ...change };
      assert.equal((await put(location)).status, 403);
      assert.equal((await fetch(url)).status, 403);
    }
    actor = { ...hr, status: 'INACTIVE' };
    assert.equal((await put(location)).status, 401);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

