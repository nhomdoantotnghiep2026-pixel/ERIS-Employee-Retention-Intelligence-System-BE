const { AppError } = require('../../common/errors/app-error');
const { USER_ROLE, UPDATABLE_HR_STATUS } = require('./users.constants');

class UsersService {
  constructor({ usersRepository, revokeUserSessions = async () => undefined }) {
    this.usersRepository = usersRepository;
    this.revokeUserSessions = revokeUserSessions;
  }

  async updateHrStatus({ actorId, userId, status }) {
    const actor = await this.usersRepository.findUserRoleById(actorId);
    if (actor?.role !== USER_ROLE.ADMIN) {
      throw new AppError(403, 'Only ADMIN can update HR account status.');
    }

    const targetUser = await this.usersRepository.findUserById(userId);
    if (!targetUser) {
      throw new AppError(404, 'User not found.');
    }

    if (targetUser.role !== USER_ROLE.HR) {
      throw new AppError(403, 'Only HR account status can be updated.');
    }

    const updatedUser = await this.usersRepository.updateHrStatus(userId, status);

    if (!updatedUser) {
      throw new AppError(404, 'User not found.');
    }

    if (status === UPDATABLE_HR_STATUS.INACTIVE) {
      await this.revokeUserSessions(userId);
    }

    return {
      id: updatedUser.id,
      email: updatedUser.email,
      fullName: updatedUser.fullName,
      role: USER_ROLE.HR,
      status: updatedUser.status,
      createdAt: updatedUser.createdAt
    };
  }
}

module.exports = { UsersService };
