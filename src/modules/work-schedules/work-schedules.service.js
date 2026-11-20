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
  async assign(actorId, rawEmployeeId, body) {
    const actor = await this.repository.findActor(actorId);
    if (actor?.role !== 'HR' || actor.status !== 'ACTIVE') throw new AppError(403, 'Only active HR users can assign work schedules.');
    const employeeId = validateScheduleId(rawEmployeeId);
    return this.repository.assign(employeeId, validateAssignmentInput(body), actorId);
  }
  async removeAssignment(actorId,rawEmployeeId,rawAssignmentId,body) {
    const actor=await this.repository.findActor(actorId);
    if(actor?.role!=='HR'||actor.status!=='ACTIVE')throw new AppError(403,'Only active HR users can remove schedule assignments.');
    const employeeId=validateScheduleId(rawEmployeeId),assignmentId=validateScheduleId(rawAssignmentId);
    if(body!==undefined&&(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length))throw new AppError(400,'This endpoint does not accept body fields.');
    return this.repository.removeAssignment(employeeId,assignmentId,actorId);
  }
  async createIndividual(actorId,input){
    const actor=await this.repository.findActor(actorId);
    if(actor?.role!=='HR'||actor.status!=='ACTIVE')throw new AppError(403,'Only active HR users can create individual schedules.');
    const {schedule,employeeId,assignment}=validateCreateIndividual(input);
    if(schedule.status!=='ACTIVE')throw new AppError(400,'Lịch riêng mới gán phải ACTIVE.');
    return this.repository.createIndividual(schedule,employeeId,assignment,actorId);
  }
  async create(actorId, input) {
    const actor = await this.repository.findActor(actorId);
    if (actor?.role !== 'HR' || actor.status !== 'ACTIVE') throw new AppError(403, 'Only active HR users can create work schedules.');
    return this.repository.create(validateCreateScheduleInput(input), actorId);
  }
}
module.exports = { WorkSchedulesService };
