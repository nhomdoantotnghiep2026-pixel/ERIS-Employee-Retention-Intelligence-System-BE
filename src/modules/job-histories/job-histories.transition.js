const { AppError } = require('../../common/errors/app-error');

function todayInVietnam(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function previousDay(date) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() - 1);
  return value.toISOString().slice(0, 10);
}

function inferChangeType(current, departmentId, targetPosition) {
  if (Number(current.departmentId) !== departmentId) return 'ROLE_CHANGE';
  if (Number(targetPosition.jobLevel) > Number(current.jobLevel)) return 'PROMOTION';
  return 'ROLE_CHANGE';
}

async function recordJobChange(repo, current, changes, today = todayInVietnam()) {
  const departmentId = changes.departmentId ?? Number(current.departmentId);
  const positionId = changes.positionId ?? Number(current.positionId);
  const departmentChanged = departmentId !== Number(current.departmentId);
  const positionChanged = positionId !== Number(current.positionId);
  if (!departmentChanged && !positionChanged) return null;
  if (departmentChanged && !positionChanged) {
    throw new AppError(400, 'Đổi phòng ban phải chọn một vị trí mới khác vị trí hiện tại.');
  }

  const department = await repo.targetDepartment(departmentId);
  const position = await repo.targetPosition(positionId);
  if (department?.status !== 'ACTIVE') throw new AppError(404, 'Không tìm thấy phòng ban ACTIVE.');
  if (position?.status !== 'ACTIVE') throw new AppError(404, 'Không tìm thấy vị trí ACTIVE.');
  if (Number(position.departmentId) !== departmentId) throw new AppError(400, 'Vị trí công việc không thuộc phòng ban đã chọn.');

  const latest = await repo.latest(current.id);
  const oldEndDate = previousDay(today);
  if (!latest) {
    // Legacy employees may predate job histories. This uses their hire date as the best
    // available start date for the current position; no earlier changes can be inferred.
    if (!current.hireDate || current.hireDate >= today) {
      throw new AppError(409, 'Chưa thể đổi vị trí trong ngày tuyển dụng khi lịch sử chỉ lưu ngày; hãy thử vào ngày tiếp theo.');
    }
    await repo.insert(current.id, {
      departmentId: Number(current.departmentId), positionId: Number(current.positionId),
      startDate: current.hireDate, endDate: oldEndDate
    }, 'HIRE');
  } else {
    if (latest.endDate !== null) throw new AppError(409, 'Lịch sử chưa có bản ghi công việc đang mở.');
    if (latest.startDate >= today) throw new AppError(409, 'Không thể đổi vị trí hai lần trong cùng ngày khi lịch sử chỉ lưu ngày.');
    if (Number(latest.departmentId) !== Number(current.departmentId) ||
        Number(latest.positionId) !== Number(current.positionId)) {
      throw new AppError(409, 'Lịch sử và hồ sơ hiện tại không khớp; cần kiểm tra dữ liệu trước khi thay đổi.');
    }
    await repo.closeCurrent(latest.id, oldEndDate);
  }

  if (await repo.hasOverlap(current.id, today, null)) {
    throw new AppError(409, 'Lịch sử công việc có khoảng ngày chồng lấn.');
  }
  return repo.insert(current.id, {
    departmentId, positionId, startDate: today, endDate: null
  }, inferChangeType(current, departmentId, position));
}

module.exports = { recordJobChange, inferChangeType, todayInVietnam };
