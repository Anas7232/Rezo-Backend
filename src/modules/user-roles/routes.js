import express from "express";
import userRoleController from "./controller.js";
import { authenticateUser } from "../../middlewares/authentication.js";
import validateRequest from "../../middlewares/validate.js";

const router = express.Router();
router.use(authenticateUser());

/**
 * @route POST /user-roles/assign
 * @desc Assign a role to a user
 * @access Admin only
 */
router.post(
  "/assign",
  // authMiddleware(["admin"]),
  // validateRequest("assignRoleSchema"),
  (req, res, next) => userRoleController.assignRole(req, res, next)
);

/**
 * @route DELETE /user-roles/remove
 * @desc Remove a role from a user
 * @access Admin only
 */
router.delete(
  "/remove",
  // authMiddleware(["admin"]),
  validateRequest("removeRoleSchema"),
  (req, res, next) => userRoleController.removeRole(req, res, next)
);

/**
 * @route GET /user-roles/:userId
 * @desc Get roles of a user
 * @access Admin/User
 */
router.get(
  "/:userId",
  // authMiddleware(),
  (req, res, next) => userRoleController.listUserRoles(req, res, next)
);

export default router;
