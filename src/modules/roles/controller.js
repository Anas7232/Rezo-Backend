import { validate } from "./schemas.js";
import {
  BadRequestError,
  NotFoundError,
  ForbiddenError,
  DatabaseError,
  ConflictError,
} from "../../utils/apiError.js";
import { sanitizeOutput } from "../../utils/sanitization.js";
import logger from "../../config/logger.js";
import roleService from "./service.js"; 
import { validate as isUuid } from "uuid";

/**
 * RoleController handles API requests for role management.
 */
export class RoleController {
  constructor() {
    this.roleService = roleService;
  }

  /**
   * @api {post} /roles Create Role
   * @apiPermission admin
   */
  async createRole(req, res, next) {
    try {
      const { body, user } = req;
      validate(body, "createRoleSchema");

      logger.info("📌 Creating role", { body, actorId: user.id });

      const role = await this.roleService.createRole(body, user.id);

      res.status(201).json({
        status: "success",
        data: this.transformRoleResponse(role),
      });
    } catch (error) {
      next(this.handleServiceError(error, "create role"));
    }
  }

  /**
   * @api {get} /roles/:id Get Role
   * @apiPermission user.read
   */
  async getRole(req, res, next) {
    try {
      const { id } = req.params;
      validate({ id }, "idSchema");

      const options = {
        includePermissions: req.query.includePermissions === "true",
        includeUsers: req.query.includeUsers === "true",
      };

      logger.debug("🔍 Fetching role", { roleId: id, options });

      const role = await this.roleService.getRole(id, options);

      res.status(200).json({
        status: "success",
        data: this.transformRoleResponse(role),
      });
    } catch (error) {
      next(this.handleServiceError(error, "fetch role"));
    }
  }

  /**
   * @api {patch} /roles/:id Update Role
   * @apiPermission admin
   */
  async updateRole(req, res, next) {
    try {
      const { id } = req.params;
      const { body, user } = req;
      if (!isUuid(id)) {
        throw new BadRequestError("Invalid role ID format");
      }

      validate({ id }, "idSchema");
      validate(body, "updateRoleSchema");

      logger.info("✏️ Updating role", { roleId: id, updates: body, actorId: user.id });

      const updatedRole = await this.roleService.updateRole(id, body, user.id);

      res.status(200).json({
        status: "success",
        data: this.transformRoleResponse(updatedRole),
      });
    } catch (error) {
      next(this.handleServiceError(error, "update role"));
    }
  }

  /**
   * @api {delete} /roles/:id Delete Role
   * @apiPermission admin
   */
  async deleteRole(req, res, next) {
    try {
      const { id } = req.params;
      validate({ id }, "idSchema");

      logger.warn("🚨 Deleting role", { roleId: id, actorId: req.user.id });

      await this.roleService.deleteRole(id, req.user.id);

      res.status(200).json({
        status: "success",
        message: "Role deleted successfully",
      });
    } catch (error) {
      next(this.handleServiceError(error, "delete role"));
    }
  }

  /**
   * @api {get} /roles List Roles
   * @apiPermission user.read
   */
  async listRoles(req, res, next) {
    try {
      const { query } = req;
      const page = parseInt(query.page, 10) || 1;
      const limit = parseInt(query.limit, 10) || 25;

      logger.debug("📄 Listing roles", { page, limit });

      const result = await this.roleService.listRoles({
        page,
        limit,
        includePermissions: query.includePermissions === "true",
      });

      res.status(200).json({
        status: "success",
        data: result.data.map(this.transformRoleResponse),
        meta: result.meta,
      });
    } catch (error) {
      next(this.handleServiceError(error, "list roles"));
    }
  }

  /**
   * @api {post} /roles/:id/permissions Assign Permissions
   * @apiPermission admin
   */
  async assignPermissions(req, res, next) {
    try {
      const { id } = req.params;
      const { permissionIds } = req.body;
      const { user } = req;

      validate({ id }, "idSchema");
      validate({ permissionIds }, "assignPermissionsSchema");

      logger.info("🔑 Assigning permissions", { roleId: id, permissionIds });

      const result = await this.roleService.assignPermissions(id, permissionIds, user.id);

      res.status(200).json({
        status: "success",
        data: result,
      });
    } catch (error) {
      next(this.handleServiceError(error, "assign permissions"));
    }
  }

  // Utility methods
  transformRoleResponse(role) {
    return sanitizeOutput(role, ["passwordHash", "deletedAt", "version"], {
      permissions: role.permissions?.map((p) => ({
        id: p.id,
        resource: p.resource,
        action: p.action,
      })),
      users: role.users?.map((u) => ({
        id: u.id,
        email: u.email,
        username: u.username,
      })),
    });
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
      return new ConflictError(`Role conflict: ${error.message}`);
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

// ✅ Correct instantiation at the bottom
export default new RoleController();
