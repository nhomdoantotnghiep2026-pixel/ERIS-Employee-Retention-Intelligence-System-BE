const {
  validatePositionId,
  validateCreatePositionInput,
  validateUpdatePositionInput,
  validatePositionListQuery
} = require('./positions.validation');

class PositionsController {
  constructor(positionsService) {
    this.positionsService = positionsService;
    this.listPositions = this.listPositions.bind(this);
    this.getPosition = this.getPosition.bind(this);
    this.createPosition = this.createPosition.bind(this);
    this.updatePosition = this.updatePosition.bind(this);
    this.deactivatePosition = this.deactivatePosition.bind(this);
  }

  async listPositions(request, response, next) {
    try {
      const data = await this.positionsService.listPositions(request.auth.userId, validatePositionListQuery(request.query));
      return response.status(200).json({ data });
    } catch (error) {
      return next(error);
    }
  }

  async getPosition(request, response, next) {
    try {
      const positionId = validatePositionId(request.params.id);
      const data = await this.positionsService.getPosition({
        actorId: request.auth.userId,
        positionId
      });

      return response.status(200).json({ data });
    } catch (error) {
      return next(error);
    }
  }

  async createPosition(request, response, next) {
    try {
      const position = validateCreatePositionInput(request.body);
      const data = await this.positionsService.createPosition({
        actorId: request.auth.userId,
        position
      });

      return response.status(201).json({
        message: 'Position created successfully.',
        data
      });
    } catch (error) {
      return next(error);
    }
  }

  async updatePosition(request, response, next) {
    try {
      const positionId = validatePositionId(request.params.id);
      const position = validateUpdatePositionInput(request.body);
      const data = await this.positionsService.updatePosition({
        actorId: request.auth.userId,
        positionId,
        position
      });

      return response.status(200).json({
        message: 'Position updated successfully.',
        data
      });
    } catch (error) {
      return next(error);
    }
  }

  async deactivatePosition(request, response, next) {
    try {
      const positionId = validatePositionId(request.params.id);
      const data = await this.positionsService.deactivatePosition({
        actorId: request.auth.userId,
        positionId
      });

      return response.status(200).json({
        message: 'Position deactivated successfully.',
        data
      });
    } catch (error) {
      return next(error);
    }
  }
}

module.exports = { PositionsController };
