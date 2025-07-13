import { PrismaClient } from "@prisma/client";
import logger from "../../config/logger.js";
import { NotFoundError, ConflictError, DatabaseError } from "../../utils/apiError.js";
import redis from "../../config/redis.js"; 

const prisma = new PrismaClient();
const CACHE_TTL = 300; // 5 minutes
const USER_ROLE_CACHE_PREFIX = "user_roles:";

class UserRoleService {
    /**
     * Assign a role to a user
     */
    async assignRole(userId, roleId, assignedBy) {
        try {
            const role = await prisma.role.findUnique({ where: { id: roleId } });
            if (!role) throw new NotFoundError("Role not found");

            const existingAssignment = await prisma.userRole.findUnique({
                where: { userId_roleId: { userId, roleId } }
            });

            if (existingAssignment) throw new ConflictError("User already has this role");

            const assignment = await prisma.userRole.create({
                data: { userId, roleId, assignedBy }
            });

            // Invalidate cache
            await redis.del(`${USER_ROLE_CACHE_PREFIX}${userId}`);

            logger.info(`✅ Role assigned: ${roleId} -> ${userId}`);
            return assignment;
        } catch (error) {
            logger.error(`❌ Error assigning role: ${error.message}`);
            throw new DatabaseError("Failed to assign role");
        }
    }

    /**
     * Remove a role from a user
     */
    async removeRole(userId, roleId) {
        try {
            const existingAssignment = await prisma.userRole.findUnique({
                where: { userId_roleId: { userId, roleId } }
            });

            if (!existingAssignment) throw new NotFoundError("User does not have this role");

            await prisma.userRole.delete({ where: { userId_roleId: { userId, roleId } } });

            // Invalidate cache
            await redis.del(`${USER_ROLE_CACHE_PREFIX}${userId}`);

            logger.info(`✅ Role removed: ${roleId} -> ${userId}`);
        } catch (error) {
            logger.error(`❌ Error removing role: ${error.message}`);
            throw new DatabaseError("Failed to remove role");
        }
    }

    /**
     * Get roles assigned to a user
     */
    async getUserRoles(userId) {
        try {
            // Check cache first
            const cacheKey = `${USER_ROLE_CACHE_PREFIX}${userId}`;
            const cachedRoles = await redis.get(cacheKey);
            if (cachedRoles) return JSON.parse(cachedRoles);

            const roles = await prisma.userRole.findMany({
                where: { userId },
                include: { role: true }
            });

            // Store result in cache
            await redis.setex(cacheKey, CACHE_TTL, JSON.stringify(roles));

            return roles;
        } catch (error) {
            logger.error(`❌ Error fetching user roles: ${error.message}`);
            throw new DatabaseError("Failed to fetch user roles");
        }
    }
}

export default new UserRoleService();
