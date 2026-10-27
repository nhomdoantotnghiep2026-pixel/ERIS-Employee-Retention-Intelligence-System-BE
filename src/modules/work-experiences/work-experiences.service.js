const { AppError } = require('../../common/errors/app-error');
class WorkExperiencesService {
  constructor(repository) { this.repository = repository; }
  async listAll(actorId) {
    return this.repository.withHr(actorId, undefined, false, async repo => ({ data: await repo.listAll() }));
  }
  async list(actorId, employeeId) {
    return this.repository.withHr(actorId, employeeId, false, async (repo, employee) => ({ employee, data: await repo.list(employeeId) }));
  }
  async delete(actorId, employeeId, experienceId) {
    return this.repository.withHr(actorId, employeeId, true, async repo => {
      const record = await repo.deactivate(employeeId, experienceId);
      if (!record) throw new AppError(404, 'Không tìm thấy kinh nghiệm đang ACTIVE của nhân viên này.');
      return { message: 'Đã xóa mềm kinh nghiệm làm việc.', data: record };
    });
  }
}
module.exports = { WorkExperiencesService };
