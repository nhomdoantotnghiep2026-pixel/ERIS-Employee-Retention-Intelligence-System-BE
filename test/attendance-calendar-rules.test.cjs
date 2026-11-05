const test = require('node:test');
const assert = require('node:assert/strict');
const { validateLeave } = require('../src/modules/attendance/attendance-calendar');
const { createAttendanceService } = require('../src/modules/attendance/attendance.service');

test('ngày bắt đầu đơn nghỉ nhận mọi ngày trong tương lai theo giờ Việt Nam', () => {
  const now = new Date('2026-11-04T16:30:00Z'); // 23:30 tại Việt Nam
  const request = date => ({ fromDate: date, toDate: date, reason: 'Việc riêng' });
  assert.throws(() => validateLeave(request('2026-11-04'), now), { statusCode: 400 });
  assert.equal(validateLeave(request('2026-11-05'), now).fromDate, '2026-11-05');
  assert.equal(validateLeave(request('2026-11-06'), now).fromDate, '2026-11-06');
  assert.equal(validateLeave(request('2026-11-12'), now).fromDate, '2026-11-12');
  assert.throws(() => validateLeave(request('2026-11-05'), new Date('2026-11-04T17:01:00Z')), { statusCode: 400 });
});

test('ngày lễ được ghi vào attendance đúng ngày và đồng bộ lại cho nhân viên mới ACTIVE', async () => {
  let now = new Date('2026-11-04T02:00:00Z');
  let marked = 0;
  const holidays = new Map();
  const service = createAttendanceService({attendance:{latitude:0,longitude:0,radiusMeters:100,maxAccuracyMeters:50}},
    { markHoliday: async date => { marked++; assert.equal(date, '2026-11-05'); return 2; } },
    () => now, null,
    { holiday: async date => holidays.get(date), addHoliday: async holiday => { holidays.set(holiday.date, holiday); return 1; }, removeHoliday: async date => holidays.delete(date) });
  const hr = {id:1,status:'ACTIVE',role_name:'HR',employeeId:1};
  const created = await service.createHoliday(hr,{date:'2026-11-05',name:'Nghỉ lễ'});
  assert.equal(created.affectedEmployees,0);
  assert.equal(marked,0);
  now = new Date('2026-11-04T17:01:00Z'); // 00:01 ngày 05/11 tại Việt Nam
  assert.equal((await service.syncTodayHoliday()).affectedEmployees,2);
  assert.equal((await service.syncTodayHoliday()).affectedEmployees,2);
  assert.equal(marked,2);
});
