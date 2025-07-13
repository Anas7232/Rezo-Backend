import { validate } from "./schemas.js";
import {
  BadRequestError,
  NotFoundError,
  ConflictError,
  DatabaseError,
} from "../../utils/apiError.js";
import rolePermissionService from "./service.js";
import logger from "../../config/logger.js";

/**
 * @class RolePermissionController
 * Manages API requests for role-permission associations
 */
class RolePermissionController {
  /**
   * Assign a permission to a role
   */
  async assignPermission(req, res, next) {
    try {
      const { roleId, permissionId } = req.body;
      validate({ roleId, permissionId }, "assignPermissionSchema");

      logger.info(`🔑 Assigning permission ${permissionId} to role ${roleId}`);

      const result = await rolePermissionService.assignPermission(
        roleId,
        permissionId
      );

      res.status(201).json({
        status: "success",
        message: "Permission assigned successfully",
        data: result,
      });
    } catch (error) {
      next(this.handleServiceError(error, "assign permission"));
    }
  }

  /**
   * Get all permissions associated with a role
   */
  async getRolePermissions(req, res, next) {
    try {
      const { roleId } = req.params;
      validate({ roleId }, "idSchema");

      logger.debug(`📄 Fetching permissions for role ${roleId}`);

      const permissions = await rolePermissionService.getRolePermissions(
        roleId
      );

      res.status(200).json({
        status: "success",
        data: permissions,
      });
    } catch (error) {
      next(this.handleServiceError(error, "get role permissions"));
    }
  }

  /**
   * Remove a permission from a role
   */
  async removePermission(req, res, next) {
    try {
      const { roleId, permissionId } = req.body;
      validate({ roleId, permissionId }, "removePermissionSchema");

      logger.warn(`🚨 Removing permission ${permissionId} from role ${roleId}`);

      await rolePermissionService.removePermission(roleId, permissionId);

      res.status(200).json({
        status: "success",
        message: "Permission removed successfully",
      });
    } catch (error) {
      next(this.handleServiceError(error, "remove permission"));
    }
  }

  /**
   * Handle errors
   */
  handleServiceError(error, context) {
    logger.error(`❌ Error in ${context}: ${error.message}`);
    if (error instanceof BadRequestError)
      return new BadRequestError(error.message);
    if (error instanceof NotFoundError) return new NotFoundError(error.message);
    if (error instanceof ConflictError) return new ConflictError(error.message);
    if (error instanceof DatabaseError)
      return new DatabaseError("Database operation failed");
    return error;
  }
}

export default new RolePermissionController();
