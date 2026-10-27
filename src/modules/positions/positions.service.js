const { AppError } = require('../../common/errors/app-error');

class PositionsService {
  constructor({ positionsRepository }) {
    this.positionsRepository = positionsRepository;
  }

  async listPositions(actorId, departmentId = null) {
    const actor = await this.positionsRepository.findUserRoleById(actorId);

    if (actor?.role !== 'HR') {
      throw new AppError(403, 'Only HR can view positions.');
    }

    return this.positionsRepository.findAll(departmentId);
  }

  async getPosition({ actorId, positionId }) {
    const actor = await this.positionsRepository.findUserRoleById(actorId);

    if (actor?.role !== 'HR') {
      throw new AppError(403, 'Only HR can view positions.');
    }

    const position = await this.positionsRepository.findById(positionId);
    if (!position) {
      throw new AppError(404, 'Position not found.');
    }

    return position;
  }

  async createPosition({ actorId, position }) {
    const actor = await this.positionsRepository.findUserRoleById(actorId);

    if (actor?.role !== 'HR') {
      throw new AppError(403, 'Only HR can create positions.');
    }

    return this.positionsRepository.create(position);
  }

  async updatePosition({ actorId, positionId, position }) {
    const actor = await this.positionsRepository.findUserRoleById(actorId);

    if (actor?.role !== 'HR') {
      throw new AppError(403, 'Only HR can update positions.');
    }

    const existingPosition = await this.positionsRepository.findById(positionId);
    if (!existingPosition) {
      throw new AppError(404, 'Position not found.');
    }

    return this.positionsRepository.update(positionId, position);
  }

  async deactivatePosition({ actorId, positionId }) {
    const actor = await this.positionsRepository.findUserRoleById(actorId);

    if (actor?.role !== 'HR') {
      throw new AppError(403, 'Only HR can deactivate positions.');
    }

    const position = await this.positionsRepository.findById(positionId);
    if (!position) {
      throw new AppError(404, 'Position not found.');
    }

    if (position.status === 'INACTIVE') {
      throw new AppError(409, 'Position is already inactive.');
    }

    if (await this.positionsRepository.hasActiveEmployees(positionId)) {
      throw new AppError(409, 'Cannot deactivate a position that still has active employees.');
    }

    return this.positionsRepository.deactivate(positionId);
  }
}

module.exports = { PositionsService };
