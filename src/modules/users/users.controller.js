const { validateUpdateUserStatusInput, validateUserId, validateAccountId } = require('./users.validation');

class UsersController {
  constructor(usersService) {
    this.usersService = usersService;
    this.listUsers = this.listUsers.bind(this);
    this.getUser = this.getUser.bind(this);
    this.updateStatus = this.updateStatus.bind(this);
  }

  async listUsers(request, response, next) {
    try {
      const data = await this.usersService.listUsers(request.auth.userId);
      return response.status(200).json({ data });
    } catch (error) { return next(error); }
  }

  async getUser(request, response, next) {
    try {
      const userId = validateAccountId(request.params.id);
      const data = await this.usersService.getUser({ actorId: request.auth.userId, userId });
      return response.status(200).json({ data });
    } catch (error) { return next(error); }
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
