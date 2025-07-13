import express from "express";
import PermissionController from "./controller.js";
import { validatePermission } from "./schemas.js";
import { authenticateUser } from "../../middlewares/authentication.js";

const router = express.Router();
router.use(authenticateUser());

/**
 * @route POST /permissions
 * @desc Create a new permission
 * @access Admin only
 */
router.post(
  "/",
  //  authMiddleware(["admin"]),
  validatePermission,
  (req, res, next) => PermissionController.createPermission(req, res, next)
);

/**
 * @route GET /permissions
 * @desc List all permissions
 * @access Admin & authorized users
 */
router.get(
  "/",
  // authMiddleware(),
  (req, res, next) => PermissionController.listPermissions(req, res, next)
);

/**
 * @route GET /permissions/:id
 * @desc Get details of a specific permission
 * @access Admin & authorized users
 */
router.get(
  "/:id",
  //  authMiddleware(),
  (req, res, next) => PermissionController.getPermission(req, res, next)
);

/**
 * @route PATCH /permissions/:id
 * @desc Update a permission
 * @access Admin only
 */
router.patch(
  "/:id",
  //  authMiddleware(["admin"]),
  validatePermission,
  (req, res, next) => PermissionController.updatePermission(req, res, next)
);

/**
 * @route DELETE /permissions/:id
 * @desc Delete a permission
 * @access Admin only
 */
router.delete(
  "/:id",
  //  authMiddleware(["admin"]),
  (req, res, next) => PermissionController.deletePermission(req, res, next)
);

export default router;
