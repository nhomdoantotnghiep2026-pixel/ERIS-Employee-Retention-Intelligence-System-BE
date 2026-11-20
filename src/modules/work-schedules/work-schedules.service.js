const { AppError } = require('../../common/errors/app-error');
const { validateCreateScheduleInput, validateScheduleId, validateSchedulePatch, prepareScheduleUpdate, validateAssignmentInput, validateCreateIndividual } = require('./work-schedules.validation');
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
    return this.repository.update(id, actorId, existing => prepareScheduleUpdate(existing, false, patch));
  }
  async setDefault(actorId, rawId, body) {
    const actor = await this.repository.findActor(actorId);
    if (actor?.role !== 'HR' || actor.status !== 'ACTIVE') throw new AppError(403, 'Only active HR users can set the default schedule.');
    throw new AppError(410,'Default scheduling is not supported. Assign a shift to an employee for attendance import matching.');
  }
  async listAssignments(actorId, rawEmployeeId) {
    const actor = await this.repository.findActor(actorId);
    if (actor?.role !== 'HR' || actor.status !== 'ACTIVE') throw new AppError(403, 'Only active HR users can view schedule assignments.');
    const employeeId = validateScheduleId(rawEmployeeId);
    return this.repository.findAssignments(employeeId);
  }
  async retiredAssignment(actorId) {
    const actor=await this.repository.findActor(actorId);
    if(actor?.role!=='HR'||actor.status!=='ACTIVE')throw new AppError(403,'Only ACTIVE HR can access this endpoint.');
    throw new AppError(410,'Separate schedule assignment is retired. Include shift_type when importing employee profiles.');
  }
  async assign(actorId) { return this.retiredAssignment(actorId); }
  async removeAssignment(actorId) { return this.retiredAssignment(actorId); }
  async createIndividual(actorId) { return this.retiredAssignment(actorId); }
  async create(actorId, input) {
    const actor = await this.repository.findActor(actorId);
    if (actor?.role !== 'HR' || actor.status !== 'ACTIVE') throw new AppError(403, 'Only active HR users can create work schedules.');
    return this.repository.create(validateCreateScheduleInput(input), actorId);
  }
}
module.exports = { WorkSchedulesService };
