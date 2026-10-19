const {
  validateCreateEmployeeInput,
  validateUpdateEmployeeInput,
  validateEmployeeId
} = require('./employees.validation');

class EmployeesController {
  constructor(employeesService) {
    this.employeesService = employeesService;
    this.createEmployee = this.createEmployee.bind(this);
    this.updateEmployee = this.updateEmployee.bind(this);
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
