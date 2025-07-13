import express from "express";
import { RoleController } from "./controller.js";
import RoleService from "./service.js";
import { authenticateUser } from "../../middlewares/authentication.js";
import validateRequest from "../../middlewares/validate.js";
import {
  createRoleSchema,
  updateRoleSchema,
  // assignPermissionsSchema,
} from "./schemas.js";

const router = express.Router();
const roleController = new RoleController(RoleService);
router.use(authenticateUser());

/**
 * @route POST /roles
 * @desc Create a new role
 * @access Admin only
 */
router.post(
  "/",
  // authMiddleware(), // Restrict access to admins
  validateRequest(createRoleSchema), // Validate request body
  (req, res, next) => roleController.createRole(req, res, next)
);

/**
 * @route GET /roles
 * @desc List all roles with optional filters
 * @access Users with "user.read" permission
 */
router.get(
  "/",
  // authMiddleware(), // Restrict access based on permissions
  (req, res, next) => roleController.listRoles(req, res, next)
);

/**
 * @route GET /roles/:id
 * @desc Get details of a specific role
 * @access Users with "user.read" permission
 */
router.get(
  "/:id",
  //  authMiddleware(),
  (req, res, next) => roleController.getRole(req, res, next)
);

/**
 * @route PATCH /roles/:id
 * @desc Update an existing role
 * @access Admin only
 */
router.patch(
  "/:id",
  // authMiddleware(),
  validateRequest(updateRoleSchema),
  (req, res, next) => roleController.updateRole(req, res, next)
);

/**
 * @route DELETE /roles/:id
 * @desc Soft-delete a role
 * @access Admin only
 */
router.delete(
  "/:id",
  // authMiddleware(),
  (req, res, next) => roleController.deleteRole(req, res, next)
);

/**
 * @route POST /roles/:id/permissions
 * @desc Assign permissions to a role
 * @access Admin only
 */
router.post(
  "/:id/permissions",
  // authMiddleware(),
  // validateRequest(assignPermissionsSchema),
  (req, res, next) => roleController.assignPermissions(req, res, next)
);

export default router;
