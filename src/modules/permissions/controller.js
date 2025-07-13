import PermissionService from "./service.js";
import logger from "../../config/logger.js";
import {
  BadRequestError,
  NotFoundError,
  ForbiddenError,
  DatabaseError,
  ConflictError,
  ConfigurationError,
} from "../../utils/apiError.js";
class PermissionController {
  async createPermission(req, res, next) {
    try {
      const { body } = req;
      logger.info(`📌 Creating permission: ${JSON.stringify(body)}`);

      const permission = await PermissionService.createPermission(body);

      res.status(201).json({
        status: "success",
        data: permission,
      });
    } catch (error) {
      logger.error(`❌ Error in create permission: ${error.message}`);

      if (error instanceof ConflictError) {
        return res.status(409).json({ error: error.message });
      }

      if (error instanceof ConfigurationError) {
        return res.status(500).json({ error: error.message });
      }

      next(this.handleServiceError(error, "create permission"));
    }
  }

  async getPermission(req, res, next) {
    try {
      const { id } = req.params;
      logger.info(`🔍 Fetching permission with ID: ${id}`);

      const permission = await PermissionService.getPermissionById(id);
      res.status(200).json({ status: "success", data: permission });
    } catch (error) {
      next(error);
    }
  }

  async listPermissions(req, res, next) {
    try {
      const permissions = await PermissionService.listPermissions();
      res.status(200).json({ status: "success", data: permissions });
    } catch (error) {
      next(error);
    }
  }

  async updatePermission(req, res, next) {
    try {
      const { id } = req.params;
      logger.info(`✏️ Updating permission with ID: ${id}`);

      const updatedPermission = await PermissionService.updatePermission(
        id,
        req.body
      );
      res.status(200).json({ status: "success", data: updatedPermission });
    } catch (error) {
      next(error);
    }
  }

  async deletePermission(req, res, next) {
    try {
      const { id } = req.params;
      logger.warn(`🚨 Deleting permission with ID: ${id}`);

      const response = await PermissionService.deletePermission(id);
      res.status(200).json({ status: "success", message: response.message });
    } catch (error) {
      next(error);
    }
  }
  handleServiceError(error, context) {
    logger.error(`❌ Error in ${context}: ${error.message}`);

    if (error instanceof BadRequestError) {
      return new BadRequestError(error.message);
    }
    if (error instanceof NotFoundError) {
      return new NotFoundError(`Role ${error.message}`);
    }
    if (error instanceof ConflictError) {
      return new ConflictError(`Permission conflict: ${error.message}`);
    }
    if (error instanceof ForbiddenError) {
      return new ForbiddenError(error.message);
    }
    if (error instanceof DatabaseError) {
      return new DatabaseError("Database operation failed");
    }

    return error;
  }
}

export default new PermissionController();
