const { AppError } = require('../../common/errors/app-error');

class JobHistoriesService {
  constructor(repository) { this.repository = repository; }

  async listOwn(actorId) {
    return this.repository.transaction(async repo => {
      const actor = await repo.actor(actorId);
      if (actor?.status !== 'ACTIVE' || !['EMPLOYEE', 'HR'].includes(actor.role)) {
        throw new AppError(403, 'Tài khoản không được xem lịch sử công việc cá nhân.');
      }
      if (actor.employeeId == null) throw new AppError(404, 'Tài khoản chưa có hồ sơ nhân viên.');
      const employee = await repo.employee(actor.employeeId);
      if (!employee || employee.status !== 'ACTIVE') {
        throw new AppError(403, 'Hồ sơ nhân viên chưa hoạt động.');
      }
      return { data: await repo.list(actor.employeeId) };
    });
  }

  async listAll(actorId) {
    return this.repository.transaction(async repo => {
      const actor = await repo.actor(actorId);
      if (actor?.status !== 'ACTIVE' || actor.role !== 'HR') {
        throw new AppError(403, 'Chỉ HR đang hoạt động được xem lịch sử công việc.');
      }
      return { data: await repo.listAll() };
    });
  }

  async list(actorId, employeeId) {
    return this.repository.transaction(async repo => {
      const actor = await repo.actor(actorId);
      if (actor?.status !== 'ACTIVE' || actor.role !== 'HR') {
        throw new AppError(403, 'Chỉ HR đang hoạt động được xem lịch sử công việc.');
      }
      const employee = await repo.employee(employeeId);
      if (!employee) throw new AppError(404, 'Không tìm thấy nhân viên.');
      return { data: await repo.list(employeeId) };
    });
  }
}

module.exports = { JobHistoriesService };
