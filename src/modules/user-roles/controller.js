import { validate } from "./schemas.js";
import { BadRequestError, NotFoundError, ConflictError, DatabaseError } from "../../utils/apiError.js";
import userRoleService from "./service.js";
import logger from "../../config/logger.js";

/**
 * @class UserRoleController
 * Manages API requests for user-role assignments
 */
class UserRoleController {
    /**
     * Assign a role to a user
     */
    async assignRole(req, res, next) {
        try {
            const { userId, roleId } = req.body;
            validate({ userId, roleId }, "assignRoleSchema");

            logger.info(`🔑 Assigning role ${roleId} to user ${userId}`);

            const result = await userRoleService.assignRole(userId, roleId, req.user.id);

            res.status(201).json({
                status: "success",
                message: "Role assigned successfully",
                data: result
            });
        } catch (error) {
            next(this.handleServiceError(error, "assign role"));
        }
    }

    /**
     * Remove a role from a user
     */
    async removeRole(req, res, next) {
        try {
            const { userId, roleId } = req.body;
            validate({ userId, roleId }, "removeRoleSchema");

            logger.warn(`🚨 Removing role ${roleId} from user ${userId}`);

            await userRoleService.removeRole(userId, roleId);

            res.status(200).json({
                status: "success",
                message: "Role removed successfully"
            });
        } catch (error) {
            next(this.handleServiceError(error, "remove role"));
        }
    }

    /**
     * List roles assigned to a user
     */
    async listUserRoles(req, res, next) {
        try {
            const { userId } = req.params;

            logger.debug(`📄 Fetching roles for user ${userId}`);

            const roles = await userRoleService.getUserRoles(userId);

            res.status(200).json({
                status: "success",
                data: roles
            });
        } catch (error) {
            next(this.handleServiceError(error, "list user roles"));
        }
    }

    /**
     * Handle errors
     */
    handleServiceError(error, context) {
        logger.error(`❌ Error in ${context}: ${error.message}`);
        if (error instanceof BadRequestError) return new BadRequestError(error.message);
        if (error instanceof NotFoundError) return new NotFoundError(error.message);
        if (error instanceof ConflictError) return new ConflictError(error.message);
        if (error instanceof DatabaseError) return new DatabaseError("Database operation failed");
        return error;
    }
}

export default new UserRoleController();
