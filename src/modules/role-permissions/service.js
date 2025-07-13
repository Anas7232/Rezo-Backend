import { PrismaClient } from "@prisma/client";
import logger from "../../config/logger.js";
import { NotFoundError, ConflictError, DatabaseError } from "../../utils/apiError.js";
import redis from "../../config/redis.js"; 

const prisma = new PrismaClient();
const CACHE_TTL = 300; // 5 minutes
const ROLE_PERM_CACHE_PREFIX = "role_permissions:";

class RolePermissionService {
  /**
   * Assign a permission to a role
   */
  async assignPermission(roleId, permissionId) {
    try {
      const role = await prisma.role.findUnique({ where: { id: roleId } });
      if (!role) throw new NotFoundError("Role not found");

      const permission = await prisma.permission.findUnique({ where: { id: permissionId } });
      if (!permission) throw new NotFoundError("Permission not found");

      const existingAssignment = await prisma.rolePermission.findUnique({
        where: { roleId_permissionId: { roleId, permissionId } }
      });

      if (existingAssignment) throw new ConflictError("Role already has this permission");

      const assignment = await prisma.rolePermission.create({
        data: { roleId, permissionId }
      });

      // Invalidate cache
      await redis.del(`${ROLE_PERM_CACHE_PREFIX}${roleId}`);

      logger.info(`✅ Permission assigned: ${permissionId} -> ${roleId}`);
      return assignment;
    } catch (error) {
      logger.error(`❌ Error assigning permission: ${error.message}`);
      throw new DatabaseError("Failed to assign permission");
    }
  }

  /**
   * Get permissions associated with a role
   */
  async getRolePermissions(roleId) {
    try {
      // Check cache first
      const cacheKey = `${ROLE_PERM_CACHE_PREFIX}${roleId}`;
      const cachedPermissions = await redis.get(cacheKey);
      if (cachedPermissions) return JSON.parse(cachedPermissions);

      const permissions = await prisma.rolePermission.findMany({
        where: { roleId },
        include: { permission: true }
      });

      // Store result in cache
      await redis.setex(cacheKey, CACHE_TTL, JSON.stringify(permissions));

      return permissions;
    } catch (error) {
      logger.error(`❌ Error fetching role permissions: ${error.message}`);
      throw new DatabaseError("Failed to fetch role permissions");
    }
  }

  /**
   * Remove a permission from a role
   */
  async removePermission(roleId, permissionId) {
    try {
      const existingAssignment = await prisma.rolePermission.findUnique({
        where: { roleId_permissionId: { roleId, permissionId } }
      });

      if (!existingAssignment) throw new NotFoundError("Role does not have this permission");

      await prisma.rolePermission.delete({
        where: { roleId_permissionId: { roleId, permissionId } }
      });

      // Invalidate cache
      await redis.del(`${ROLE_PERM_CACHE_PREFIX}${roleId}`);

      logger.info(`✅ Permission removed: ${permissionId} -> ${roleId}`);
    } catch (error) {
      logger.error(`❌ Error removing permission: ${error.message}`);
      throw new DatabaseError("Failed to remove permission");
    }
  }
}

export default new RolePermissionService();
