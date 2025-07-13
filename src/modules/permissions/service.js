import { PrismaClient } from "@prisma/client";
import logger from "../../config/logger.js";
import {
  NotFoundError,
  ConflictError,
  DatabaseError,
  ConfigurationError,
} from "../../utils/apiError.js";
import { CasbinPolicyManager } from "../../config/casbin.js";

const prisma = new PrismaClient();

class PermissionService {
  constructor() {
    this.policyManager = new CasbinPolicyManager();
  }

  /**
   * ✅ Create a new permission & sync with Casbin
   */
  async createPermission(data) {
    try {
      // Initialize policy manager first
      if (!this.policyManager.enforcer) {
        await this.policyManager.initialize();
      }

      // Check if permission already exists
      const existing = await prisma.permission.findUnique({
        where: {
          resource_action: { resource: data.resource, action: data.action },
        },
      });

      if (existing) {
        logger.warn(
          `⚠️ Permission already exists: ${data.resource} - ${data.action}`
        );
        throw new ConflictError(
          `Permission "${data.resource} - ${data.action}" already exists.`
        );
      }

      // Create permission in database
      const permission = await prisma.permission.create({ data });

      // ✅ Add policy using initialized enforcer
      await this.policyManager.addPermissionForUser(data.resource, data.action);

      logger.info(
        `✅ Permission created: ${permission.resource} - ${permission.action}`
      );
      return permission;
    } catch (error) {
      logger.error(`❌ Error creating permission: ${error.message}`);

      if (error instanceof ConflictError) {
        throw error; // Let controller handle 409
      }

      if (error.message.includes("Casbin enforcer")) {
        throw new ConfigurationError(
          "Casbin configuration error: " + error.message
        ); // New error type
      }

      throw new DatabaseError("Failed to create permission.");
    }
  }

  /**
   * ✅ Get a specific permission by ID
   */
  async getPermissionById(permissionId) {
    try {
      const permission = await prisma.permission.findUnique({
        where: { id: permissionId },
      });

      if (!permission) throw new NotFoundError("Permission not found");

      return permission;
    } catch (error) {
      logger.error(`❌ Error fetching permission: ${error.message}`);
      throw new DatabaseError("Failed to fetch permission");
    }
  }

  /**
   * ✅ List all permissions
   */
  async listPermissions() {
    try {
      return await prisma.permission.findMany();
    } catch (error) {
      logger.error(`❌ Error listing permissions: ${error.message}`);
      throw new DatabaseError("Failed to list permissions");
    }
  }

  /**
   * ✅ Update a permission & sync with Casbin
   */
  async updatePermission(permissionId, data) {
    try {
      const existing = await prisma.permission.findUnique({
        where: { id: permissionId },
      });

      if (!existing) throw new NotFoundError("Permission not found");

      // Update permission in DB
      const updatedPermission = await prisma.permission.update({
        where: { id: permissionId },
        data,
      });

      // ✅ Sync updated permission with Casbin
      await this.policyManager.updatePermission(
        existing.resource,
        existing.action,
        updatedPermission.resource,
        updatedPermission.action
      );

      logger.info(
        `✅ Permission updated: ${updatedPermission.resource} - ${updatedPermission.action}`
      );
      return updatedPermission;
    } catch (error) {
      logger.error(`❌ Error updating permission: ${error.message}`);
      throw new DatabaseError("Failed to update permission");
    }
  }

  /**
   * ✅ Delete a permission & remove from Casbin
   */
  async deletePermission(permissionId) {
    try {
      const existing = await prisma.permission.findUnique({
        where: { id: permissionId },
      });

      if (!existing) throw new NotFoundError("Permission not found");

      // Delete permission from DB
      await prisma.permission.delete({ where: { id: permissionId } });

      // ✅ Remove permission from Casbin
      await this.policyManager.removePermission(
        existing.resource,
        existing.action
      );

      logger.info(`✅ Permission deleted: ${permissionId}`);
      return { message: "Permission deleted successfully" };
    } catch (error) {
      logger.error(`❌ Error deleting permission: ${error.message}`);
      throw new DatabaseError("Failed to delete permission");
    }
  }
}

export default new PermissionService();
