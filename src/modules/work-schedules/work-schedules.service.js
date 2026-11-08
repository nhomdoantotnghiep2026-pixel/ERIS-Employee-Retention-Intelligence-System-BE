const { AppError } = require('../../common/errors/app-error');
const { validateCreateScheduleInput, validateScheduleId, validateSchedulePatch, prepareScheduleUpdate, validateAssignmentInput, validateCreateIndividual } = require('./work-schedules.validation');
class WorkSchedulesService {
  constructor(repository) { this.repository = repository; }
  async list(actorId) {
    const actor = await this.repository.findActor(actorId);
    if (actor?.role !== 'HR' || actor.status !== 'ACTIVE') throw new AppError(403, 'Only active HR users can view work schedules.');
    const schedules=await this.repository.findAll();
    const pending=this.repository.pendingDefault?await this.repository.pendingDefault():null;
    return schedules.map(row=>({...row,pending_default:pending?.scheduleId===row.id?{effective_from:pending.effectiveFrom}:null}));
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
  async removeAssignment(actorId,rawEmployeeId,rawAssignmentId,body) {
    const actor=await this.repository.findActor(actorId);
    if(actor?.role!=='HR'||actor.status!=='ACTIVE')throw new AppError(403,'Only active HR users can remove schedule assignments.');
    const employeeId=validateScheduleId(rawEmployeeId),assignmentId=validateScheduleId(rawAssignmentId);
    if(body!==undefined&&(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length))throw new AppError(400,'This endpoint does not accept body fields.');
    return this.repository.removeAssignment(employeeId,assignmentId,actorId);
  }
  async createDefault(actorId,input){
    const actor=await this.repository.findActor(actorId);
    if(actor?.role!=='HR'||actor.status!=='ACTIVE')throw new AppError(403,'Only active HR users can create default schedules.');
    const schedule=validateCreateScheduleInput(input);
    if(schedule.status!=='ACTIVE')throw new AppError(400,'Lịch mặc định phải ACTIVE.');
    return this.repository.createDefault(schedule,actorId);
  }
  async createIndividual(actorId,input){
    const actor=await this.repository.findActor(actorId);
    if(actor?.role!=='HR'||actor.status!=='ACTIVE')throw new AppError(403,'Only active HR users can create individual schedules.');
    const {schedule,employeeId,assignment}=validateCreateIndividual(input);
    if(schedule.status!=='ACTIVE')throw new AppError(400,'Lịch riêng mới gán phải ACTIVE.');
    return this.repository.createIndividual(schedule,employeeId,assignment,actorId);
  }
  async syncDefaults(employeeId=null){return this.repository.syncDefaults(employeeId);}
  async create(actorId, input) {
    const actor = await this.repository.findActor(actorId);
    if (actor?.role !== 'HR' || actor.status !== 'ACTIVE') throw new AppError(403, 'Only active HR users can create work schedules.');
    return this.repository.create(validateCreateScheduleInput(input), actorId);
  }
}
module.exports = { WorkSchedulesService };
