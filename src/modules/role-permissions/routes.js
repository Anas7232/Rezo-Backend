import express from "express";
import rolePermissionController from "./controller.js";
import { authenticateUser } from "../../middlewares/authentication.js";
import validateRequest from "../../middlewares/validate.js";

const router = express.Router();
router.use(authenticateUser());

/**
 * @route POST /role-permissions/assign
 * @desc Assign a permission to a role
 * @access Admin only
 */
router.post(
  "/assign",
  // authMiddleware(["admin"]),
  validateRequest("assignPermissionSchema"),
  (req, res, next) => rolePermissionController.assignPermission(req, res, next)
);

/**
 * @route GET /role-permissions/:roleId
 * @desc Get permissions of a role
 * @access Admin/User
 */
router.get("/:roleId", (req, res, next) =>
  rolePermissionController.getRolePermissions(req, res, next)
);

/**
 * @route DELETE /role-permissions/remove
 * @desc Remove a permission from a role
 * @access Admin only
 */
router.delete(
  "/remove",
  // authMiddleware(["admin"]),
  validateRequest("removePermissionSchema"),
  (req, res, next) => rolePermissionController.removePermission(req, res, next)
);

export default router;
