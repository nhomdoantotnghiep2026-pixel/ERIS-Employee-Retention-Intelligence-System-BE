const { AppError } = require('../../common/errors/app-error');
const { validateCreateScheduleInput, validateScheduleId, validateSchedulePatch, prepareScheduleUpdate, validateAssignmentInput } = require('./work-schedules.validation');
class WorkSchedulesService {
  constructor(repository) { this.repository = repository; }
  async list(actorId) {
    const actor = await this.repository.findActor(actorId);
    if (actor?.role !== 'HR' || actor.status !== 'ACTIVE') throw new AppError(403, 'Only active HR users can view work schedules.');
    return this.repository.findAll();
  }
  async update(actorId, rawId, input) {
    const actor = await this.repository.findActor(actorId);
    if (actor?.role !== 'HR' || actor.status !== 'ACTIVE') throw new AppError(403, 'Only active HR users can update work schedules.');
    const id = validateScheduleId(rawId);
    const patch = validateSchedulePatch(input);
    return this.repository.update(id, actorId, (existing, assigned) => prepareScheduleUpdate(existing, assigned, patch));
  }
  async setDefault(actorId, rawId, body) {
    const actor = await this.repository.findActor(actorId);
    if (actor?.role !== 'HR' || actor.status !== 'ACTIVE') throw new AppError(403, 'Only active HR users can set the default schedule.');
    const id = validateScheduleId(rawId);
    if (body !== undefined && (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length)) throw new AppError(400, 'This endpoint does not accept body fields.');
    return this.repository.setDefault(id, actorId);
  }
  async listAssignments(actorId, rawEmployeeId) {
    const actor = await this.repository.findActor(actorId);
    if (actor?.role !== 'HR' || actor.status !== 'ACTIVE') throw new AppError(403, 'Only active HR users can view schedule assignments.');
    const employeeId = validateScheduleId(rawEmployeeId);
    return this.repository.findAssignments(employeeId);
  }
  async assign(actorId, rawEmployeeId, body) {
    const actor = await this.repository.findActor(actorId);
    if (actor?.role !== 'HR' || actor.status !== 'ACTIVE') throw new AppError(403, 'Only active HR users can assign work schedules.');
    const employeeId = validateScheduleId(rawEmployeeId);
    return this.repository.assign(employeeId, validateAssignmentInput(body), actorId);
  }
  async create(actorId, input) {
    const actor = await this.repository.findActor(actorId);
    if (actor?.role !== 'HR' || actor.status !== 'ACTIVE') throw new AppError(403, 'Only active HR users can create work schedules.');
    return this.repository.create(validateCreateScheduleInput(input), actorId);
  }
}
module.exports = { WorkSchedulesService };
