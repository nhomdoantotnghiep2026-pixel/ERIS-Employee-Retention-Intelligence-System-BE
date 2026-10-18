const { AppError } = require('../../common/errors/app-error');

class DepartmentsService {
  constructor({ departmentsRepository }) {
    this.departmentsRepository = departmentsRepository;
  }

  async assertHr(actorId) {
    const actor = await this.departmentsRepository.findUserRoleById(actorId);

    if (actor?.role !== 'HR') {
      throw new AppError(403, 'Only HR can manage departments.');
    }
  }

  async listDepartments(actorId) {
    await this.assertHr(actorId);
    return this.departmentsRepository.findAll();
  }

  async createDepartment({ actorId, department }) {
    await this.assertHr(actorId);
    return this.departmentsRepository.create(department);
  }

  async deactivateDepartment({ actorId, departmentId }) {
    await this.assertHr(actorId);

    const department = await this.departmentsRepository.findById(departmentId);
    if (!department) {
      throw new AppError(404, 'Department not found.');
    }

    if (department.status === 'INACTIVE') {
      throw new AppError(409, 'Department is already inactive.');
    }

    if (await this.departmentsRepository.hasActiveEmployees(departmentId)) {
      throw new AppError(409, 'Cannot deactivate a department that still has active employees.');
    }

    return this.departmentsRepository.deactivate(departmentId);
  }

  async updateDepartment({ actorId, departmentId, department }) {
    await this.assertHr(actorId);

    const existingDepartment = await this.departmentsRepository.findById(departmentId);
    if (!existingDepartment) {
      throw new AppError(404, 'Department not found.');
    }

    return this.departmentsRepository.update(departmentId, department);
  }
}

module.exports = { DepartmentsService };
