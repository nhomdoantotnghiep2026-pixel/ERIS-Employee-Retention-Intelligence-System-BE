const { validateUpdateUserStatusInput, validateUserId } = require('./users.validation');

class UsersController {
  constructor(usersService) {
    this.usersService = usersService;
    this.updateStatus = this.updateStatus.bind(this);
  }

  async updateStatus(request, response, next) {
    try {
      const userId = validateUserId(request.params.id);
      const { status } = validateUpdateUserStatusInput(request.body);
      const data = await this.usersService.updateHrStatus({
        actorId: request.auth.userId,
        userId,
        status
      });

      return response.status(200).json({
        message: 'User status updated successfully.',
        data
      });
    } catch (error) {
      return next(error);
    }
  }
}

module.exports = { UsersController };
