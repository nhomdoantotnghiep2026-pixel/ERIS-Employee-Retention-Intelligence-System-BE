const {
  validateCreateEmployeeInput,
  validateUpdateEmployeeInput,
  validateListQuery,
  validateEmployeeId
} = require('./employees.validation');

class EmployeesController {
  constructor(employeesService) {
    this.employeesService = employeesService;
    this.listEmployees = this.listEmployees.bind(this);
    this.getEmployee = this.getEmployee.bind(this);
    this.createEmployee = this.createEmployee.bind(this);
    this.deleteEmployee = this.deleteEmployee.bind(this);
    this.updateEmployee = this.updateEmployee.bind(this);
  }

  async listEmployees(request, response, next) {
    try {
      const data = await this.employeesService.listEmployees({ actorId: request.auth.userId, query: validateListQuery(request.query) });
      return response.json(data);
    } catch (error) { return next(error); }
  }
  async getEmployee(request, response, next) {
    try {
      const data = await this.employeesService.getEmployee({ actorId: request.auth.userId, employeeId: validateEmployeeId(request.params.id) });
      return response.json(data);
    } catch (error) { return next(error); }
  }
  async createEmployee(request, response, next) {
    try {
      const employee = validateCreateEmployeeInput(request.body);
      const data = await this.employeesService.createEmployee({
        actorId: request.auth.userId,
        employee
      });

      return response.status(201).json({
        message: 'Employee created successfully.',
        data
      });
    } catch (error) {
      return next(error);
    }
  }

  async deleteEmployee(request, response, next) {
    try {
      const data = await this.employeesService.deleteEmployee({
        actorId: request.auth.userId, employeeId: validateEmployeeId(request.params.id)
      });
      return response.status(200).json({ message: 'Employee deactivated successfully.', data });
    } catch (error) { return next(error); }
  }
  async updateEmployee(request, response, next) {
    try {
      const employeeId = validateEmployeeId(request.params.id);
      const employee = validateUpdateEmployeeInput(request.body);
      const data = await this.employeesService.updateEmployee({
        actorId: request.auth.userId,
        employeeId,
        employee
      });

      return response.status(200).json({
        message: 'Employee updated successfully.',
        data
      });
    } catch (error) {
      return next(error);
    }
  }
}

module.exports = { EmployeesController };
