const {AppError}=require('../../common/errors/app-error');
class CareerProfileService {
  // Default follows the existing Employees module's company-wide HR access.
  constructor(repository,canAccessEmployee=async()=>true) {this.repository=repository;this.canAccessEmployee=canAccessEmployee;}
  run(actorId,role,work) {
    return this.repository.transaction(async repo=>{
      const actor=await repo.actor(actorId);
      if(actor?.status!=='ACTIVE' || actor.role!==role) throw new AppError(403,`Only ACTIVE ${role} can access this endpoint.`);
      return work(repo,actor);
    }).catch(error=>{
      if(error.code==='23505' && error.constraint==='uq_employee_active_career_profile') throw new AppError(409,'Employee already has an ACTIVE career goal.');
      throw error;
    });
  }
  own(actorId,action='read',id,data={}) {
    return this.run(actorId,'EMPLOYEE',async(repo,actor)=>{
      if(!actor.employeeId) throw new AppError(403,'No employee profile is linked to this account.');
      if(action!=='read') await repo.lockEmployee(actor.employeeId);
      if((await repo.employee(actor.employeeId))?.status!=='ACTIVE') throw new AppError(403,'Employee profile must be ACTIVE.');
      if(action==='read') return repo.goals(actor.employeeId);
      if(action==='create') {
        if((await repo.goals(actor.employeeId)).currentGoal) throw new AppError(409,'Employee already has an ACTIVE career goal.');
        return repo.insert(actor.employeeId,data,actorId);
      }
      const goal=await repo.goal(id,actor.employeeId);
      if(!goal) throw new AppError(404,'Career goal not found.');
      if(goal.status!=='ACTIVE') throw new AppError(409,'Career goal must be ACTIVE.');
      if(action==='edit') return repo.update(goal,{goalDescription:data.goalDescription},actorId);
      if(action==='complete') {
        await repo.update(goal,{status:'ACHIEVED'},actorId);
        return {id:goal.id,status:'ACHIEVED',message:'Đã ghi nhận mục tiêu hoàn thành theo tự xác nhận của nhân viên.'};
      }
      if(action==='cancel') return repo.update(goal,{status:'CANCELLED',goalChangeReason:data.goalChangeReason},actorId);
      if(action==='replace') {
        const previousGoal=await repo.update(goal,{status:'REPLACED',goalChangeReason:data.goalChangeReason},actorId);
        const currentGoal=await repo.insert(actor.employeeId,{careerAspiration:data.newCareerAspiration,goalDescription:data.newGoalDescription},actorId);
        return {previousGoal,currentGoal};
      }
      throw new AppError(400,'Unsupported career action.');
    });
  }
  getEmployee(actorId,id) {
    return this.run(actorId,'HR',async(repo,actor)=>{
      if(!await this.canAccessEmployee(actorId,id,actor)) throw new AppError(404,'Employee not found.');
      const employee=await repo.employee(id);
      if(!employee) throw new AppError(404,'Employee not found.');
      return {employee:{id:employee.id,employeeCode:employee.employeeCode,fullName:employee.fullName},...await repo.goals(id)};
    });
  }
  alerts(actorId) {
    return this.run(actorId,'HR',async(repo,actor)=>{
      const items=[];
      for(const item of await repo.alerts()) if(await this.canAccessEmployee(actorId,item.employeeId,actor)) items.push(item);
      return {items};
    });
  }
}
module.exports={CareerProfileService};
