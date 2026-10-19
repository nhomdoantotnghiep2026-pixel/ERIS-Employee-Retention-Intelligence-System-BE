const { AppError } = require('../../common/errors/app-error');

class PositionsService {
  constructor({ positionsRepository }) {
    this.positionsRepository = positionsRepository;
  }

  async listPositions(actorId) {
    const actor = await this.positionsRepository.findUserRoleById(actorId);

    if (actor?.role !== 'HR') {
      throw new AppError(403, 'Only HR can view positions.');
    }

    return this.positionsRepository.findAll();
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
}

module.exports = { PositionsService };
