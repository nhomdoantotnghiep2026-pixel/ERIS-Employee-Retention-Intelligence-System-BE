const { AppError } = require('../../common/errors/app-error');

class EmployeesService {
  constructor({ employeesRepository }) {
    this.employeesRepository = employeesRepository;
  }

  async createEmployee({ actorId, employee }) {
    const actor = await this.employeesRepository.findUserRoleById(actorId);
    if (actor?.role !== 'HR') {
      throw new AppError(403, 'Only HR can create employees.');
    }

    if (employee.email && await this.employeesRepository.findByEmail(employee.email)) {
      throw new AppError(409, 'Email is already in use.');
    }

    if (!await this.employeesRepository.findActiveDepartmentById(employee.departmentId)) {
      throw new AppError(404, 'Active department not found.');
    }

    if (!await this.employeesRepository.findActivePositionById(employee.positionId)) {
      throw new AppError(404, 'Active position not found.');
    }

    return this.employeesRepository.create(employee);
  }

  async updateEmployee({ actorId, employeeId, employee }) {
    const actor = await this.employeesRepository.findUserRoleById(actorId);
    if (actor?.role !== 'HR') {
      throw new AppError(403, 'Only HR can update employees.');
    }

    if (!await this.employeesRepository.findById(employeeId)) {
      throw new AppError(404, 'Employee not found.');
    }

    if (employee.email && await this.employeesRepository.findByEmail(employee.email, employeeId)) {
      throw new AppError(409, 'Email is already in use.');
    }

    if (Object.hasOwn(employee, 'departmentId') && !await this.employeesRepository.findActiveDepartmentById(employee.departmentId)) {
      throw new AppError(404, 'Active department not found.');
    }

    if (Object.hasOwn(employee, 'positionId') && !await this.employeesRepository.findActivePositionById(employee.positionId)) {
      throw new AppError(404, 'Active position not found.');
    }

    return this.employeesRepository.update(employeeId, employee);
  }
}

module.exports = { EmployeesService };
