const { validateEducation, validateGraduationYear } = require('./education.validation');
const { createInstitutionSearch, createInstitutionResolver } = require('./institutions.service');
const { AppError } = require('../../common/errors/app-error');
const { assessEducationLevel } = require('./education-level-advice');
class EducationService {
  constructor(repository, searchInstitutions = createInstitutionSearch(), resolveInstitution = createInstitutionResolver()) { this.repository = repository; this.searchInstitutions = searchInstitutions; this.resolveInstitution = resolveInstitution; }
  async verifySchool(actorId,input) {
    if(!Object.hasOwn(input,'institutionRefId'))return input;
    await this.repository.assertHr(actorId);
    const school=await this.resolveInstitution(input.institutionRefId);
    if(school.institution!==input.institution)throw new AppError(400,'Institution name does not match the selected school. Select it again.');
    const {institutionRefId,...fields}=input;
    return {...fields,institution:school.institution};
  }
  async activeEmployees(actorId) { await this.repository.assertHr(actorId); return {data:await this.repository.activeEmployees()}; }
  async institutions(actorId,query) { await this.repository.assertHr(actorId); return this.searchInstitutions(query); }
  async listAll(actorId) { return {data:await this.repository.listAllForHr(actorId)}; }
  async listOwn(actorId) { return {data:await this.repository.listOwn(actorId)}; }
  async list(actorId, employeeId) {
    return this.repository.withHrEmployee(actorId,employeeId,false,async repo => ({data:await repo.list(employeeId)}));
  }
  async create(actorId, employeeId, data) {
    const input=await this.verifySchool(actorId,validateEducation(data));
    return this.repository.withHrEmployee(actorId,employeeId,true,async (repo,employee) => {
      validateGraduationYear(input,employee.dateOfBirth);
      const row=await repo.create(employeeId,input);
      return {message:'Education created successfully.',data:row,warning:assessEducationLevel(row.educationLevel,row.institution).levelWarning};
    });
  }
  async update(actorId, employeeId, id, data) {
    const input=await this.verifySchool(actorId,validateEducation(data,{partial:true}));
    return this.repository.withHrEmployee(actorId,employeeId,true,async (repo,employee) => {
      const current=await repo.findById(employeeId,id);
      if(!current)throw new AppError(404,'Education record not found for this employee.');
      validateGraduationYear({...current,...input},employee.dateOfBirth);
      const row=await repo.update(employeeId,id,input);
      if(!row)throw new AppError(404,'Education record not found for this employee.');
      return {message:'Education updated successfully.',data:row,warning:assessEducationLevel(row.educationLevel,row.institution).levelWarning};
    });
  }
  async delete(actorId, employeeId, id) {
    return this.repository.withHrEmployee(actorId,employeeId,true,async repo => {
      const row=await repo.delete(employeeId,id);
      if(!row)throw new AppError(404,'Education record not found for this employee.');
      return {message:'Education deactivated successfully.',data:row};
    });
  }
}
module.exports = { EducationService };
