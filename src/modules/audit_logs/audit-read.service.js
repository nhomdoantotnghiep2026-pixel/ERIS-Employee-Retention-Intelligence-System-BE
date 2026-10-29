const { AppError } = require('../../common/errors/app-error');

// Protect legacy JSON logs that might have been written by other modules.
function redactSecrets(value) {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !/(?:password|token|secret|api[_-]?key|authorization|cookie|otp)/i.test(key))
    .map(([key, child]) => [key, redactSecrets(child)]));
  return value;
}

class AuditReadService {
  constructor(repository) { this.repository = repository; }
  async assertAdmin(actorId) {
    if (!await this.repository.isActiveAdmin(actorId)) throw new AppError(403, 'Chỉ ADMIN ACTIVE được xem audit log.');
  }
  async list(actorId) {
    await this.assertAdmin(actorId);
    return { data: await this.repository.list() };
  }
  async detail(actorId, id) {
    await this.assertAdmin(actorId);
    const record = await this.repository.findById(id);
    if (!record) throw new AppError(404, 'Không tìm thấy audit log.');
    return { data: { ...record, oldValue: redactSecrets(record.oldValue), newValue: redactSecrets(record.newValue) } };
  }
}
module.exports = { AuditReadService, redactSecrets };
