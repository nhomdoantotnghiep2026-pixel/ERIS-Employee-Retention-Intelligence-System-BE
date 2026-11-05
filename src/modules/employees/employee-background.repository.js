const { EducationRepository } = require('../employee-education/education.repository');
const { assessEducationLevel } = require('../employee-education/education-level-advice');

// Methods that write are called on the same transaction client as account/profile creation or activation.
class EmployeeBackgroundRepository {
  constructor(client) { this.client = client; }
  withWarning(education) {
    return { ...education, warning: assessEducationLevel(education.educationLevel, education.institution).levelWarning };
  }
  async create(employeeId, data, status = 'ACTIVE') {
    const educations = [];
    for (const education of data.educations) {
      const row = await new EducationRepository(this.client).create(employeeId, education, status);
      educations.push(this.withWarning(row));
    }
    return { educations, backgroundStatus: status === 'IN_PROCESS' ? 'PENDING_ACTIVATION' : 'SAVED' };
  }
  async activate(employeeId) {
    await this.client.query(`UPDATE public.employee_educations SET status='ACTIVE', updated_at=CURRENT_TIMESTAMP
      WHERE employee_id=$1 AND status='IN_PROCESS'`, [employeeId]);
  }
  async find(employeeId, includeInProcess = false) {
    const educations = await new EducationRepository(this.client).list(employeeId, includeInProcess);
    const pending = educations.some(record => record.status === 'IN_PROCESS');
    return { educations, backgroundStatus: pending ? 'PENDING_ACTIVATION' : 'SAVED' };
  }
}
module.exports = { EmployeeBackgroundRepository };
