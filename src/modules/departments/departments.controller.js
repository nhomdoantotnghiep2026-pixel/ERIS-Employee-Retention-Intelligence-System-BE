const {
  validateCreateDepartmentInput,
  validateDepartmentId,
  validateUpdateDepartmentInput
} = require('./departments.validation');

class DepartmentsController {
  constructor(departmentsService) {
    this.departmentsService = departmentsService;
    this.listDepartments = this.listDepartments.bind(this);
    this.createDepartment = this.createDepartment.bind(this);
    this.deactivateDepartment = this.deactivateDepartment.bind(this);
    this.updateDepartment = this.updateDepartment.bind(this);
  }

  async listDepartments(request, response, next) {
    try {
      const data = await this.departmentsService.listDepartments(request.auth.userId);
      return response.status(200).json({ data });
    } catch (error) {
      return next(error);
    }
  }

  async createDepartment(request, response, next) {
    try {
      const department = validateCreateDepartmentInput(request.body);
      const data = await this.departmentsService.createDepartment({
        actorId: request.auth.userId,
        department
      });

      return response.status(201).json({
        message: 'Department created successfully.',
        data
      });
    } catch (error) {
      return next(error);
    }
  }

  async deactivateDepartment(request, response, next) {
    try {
      const departmentId = validateDepartmentId(request.params.id);
      const data = await this.departmentsService.deactivateDepartment({
        actorId: request.auth.userId,
        departmentId
      });

      return response.status(200).json({
        message: 'Department deactivated successfully.',
        data
      });
    } catch (error) {
      return next(error);
    }
  }

  async updateDepartment(request, response, next) {
    try {
      const departmentId = validateDepartmentId(request.params.id);
      const department = validateUpdateDepartmentInput(request.body);
      const data = await this.departmentsService.updateDepartment({
        actorId: request.auth.userId,
        departmentId,
        department
      });

      return response.status(200).json({
        message: 'Department updated successfully.',
        data
      });
    } catch (error) {
      return next(error);
    }
  }
}

module.exports = { DepartmentsController };
