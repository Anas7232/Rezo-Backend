import logger from "../../config/logger.js";
import redis from "../../config/redis.js";
import {
  ValidationError,
  NotFoundError,
  DatabaseError,
} from "../../utils/apiError.js";
import { PrismaClient } from "@prisma/client";
import { validate as isUuid } from "uuid";

const prisma = new PrismaClient();
const ROLE_CACHE_PREFIX = "role:";
const CACHE_TTL = 300; // Cache TTL (5 minutes)

class RoleService {
  async listRoles({ page = 1, limit = 25, includePermissions = false }) {
    try {
      const [results, total] = await Promise.all([
        prisma.role.findMany({
          where: { deletedAt: { equals: null } },
          skip: (page - 1) * limit,
          take: limit,
          include: { permissions: includePermissions },
          orderBy: { createdAt: "desc" },
        }),
        prisma.role.count({ where: { deletedAt: null } }),
      ]);

      return {
        data: results,
        meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
      };
    } catch (error) {
      logger.error(`❌ Error in listRoles: ${error.message}`);
      throw new DatabaseError("Failed to list roles");
    }
  }
  async createRole(data) {
    try {
      this.validateRoleData(data);

      const role = await prisma.role.create({ data });

      // Cache new role
      await this.cacheRole(role);

      logger.info(`✅ Role created: ${role.name}`);
      return role;
    } catch (error) {
      logger.error(`❌ Error creating role: ${error.message}`);
      throw new DatabaseError("Failed to create role");
    }
  }

  async getRoles() {
    try {
      // Try to get roles from cache
      const cacheKey = `${ROLE_CACHE_PREFIX}all`;
      const cachedRoles = await redis.get(cacheKey);
      if (cachedRoles) return JSON.parse(cachedRoles);

      // Fetch from DB if not cached
      const roles = await prisma.role.findMany({ where: { deletedAt: null } });

      // Cache result
      await redis.setex(cacheKey, CACHE_TTL, JSON.stringify(roles));

      return roles;
    } catch (error) {
      logger.error(`❌ Error fetching roles: ${error.message}`);
      throw new DatabaseError("Failed to fetch roles");
    }
  }

  async getRole(id, options = {}) {
    try {
      const cacheKey = `role:${id}`;
      const cachedRole = await redis.get(cacheKey);
      if (cachedRole) return JSON.parse(cachedRole);

      const role = await prisma.role.findUnique({
        where: { id },
        include: {
          permissions: options.includePermissions
            ? { include: { permission: true } }
            : false,
          users: options.includeUsers ? { include: { user: true } } : false,
        },
      });

      if (!role) throw new NotFoundError("Role not found");

      await redis.setex(cacheKey, 300, JSON.stringify(role)); // Cache for 5 minutes
      return role;
    } catch (error) {
      logger.error(`❌ Error fetching role: ${error.message}`);
      throw new DatabaseError("Failed to fetch role");
    }
  }

  async updateRole(roleId, data) {
    try {
      if (!isUuid(roleId)) {
        throw new ValidationError("Invalid role ID format");
      }

      this.validateRoleData(data);

      const existingRole = await prisma.role.findFirst({
        where: {
          id: roleId,
          deletedAt: null,
        },
      });

      if (!existingRole) {
        throw new NotFoundError(`Role with ID ${roleId} does not exist.`);
      }

      const updatedRole = await prisma.role.update({
        where: { id: roleId },
        data,
      });

      await this.invalidateRoleCache(roleId);

      logger.info(`✅ Role updated: ${updatedRole.name}`);
      return updatedRole;
    } catch (error) {
      logger.error(`❌ Error updating role: ${error.message}`);
      
      // Preserve specific error types
      if (error instanceof NotFoundError || error instanceof ValidationError) {
        throw error; // These will be handled by the controller appropriately
      }
      
      throw new DatabaseError("Failed to update role.");
    }
  }

  async deleteRole(roleId) {
    try {
      const role = await prisma.role.update({
        where: { id: roleId, deletedAt: null },
        data: { deletedAt: new Date() }, // Soft delete
      });

      if (!role) throw new NotFoundError("Role not found");

      // Invalidate cache
      await this.invalidateRoleCache(roleId);

      logger.info(`✅ Role soft-deleted: ${role.name}`);
      return role;
    } catch (error) {
      logger.error(`❌ Error deleting role: ${error.message}`);
      throw new DatabaseError("Failed to delete role");
    }
  }

  async cacheRole(role) {
    try {
      await redis.setex(
        `${ROLE_CACHE_PREFIX}${role.id}`,
        CACHE_TTL,
        JSON.stringify(role)
      );
    } catch (error) {
      logger.warn(`⚠️ Redis cache failed: ${error.message}`);
    }
  }

  async invalidateRoleCache(roleId) {
    try {
      await redis.del(`${ROLE_CACHE_PREFIX}${roleId}`);
      await redis.del(`${ROLE_CACHE_PREFIX}all`);
    } catch (error) {
      logger.warn(`⚠️ Failed to invalidate cache: ${error.message}`);
    }
  }

  validateRoleData(data) {
    if ("name" in data && (!data.name || typeof data.name !== "string")) {
      throw new ValidationError("Invalid role name");
    }
  }
}

export default new RoleService();
