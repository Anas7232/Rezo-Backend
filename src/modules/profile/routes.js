import express from "express";
import { profileController } from "./controller.js";
import { authenticateUser } from "../../middlewares/authentication.js";
import { uploadProfilePicture } from "../../middlewares/upload.js";

const router = express.Router();

// Apply authentication to all routes
router.get("/search", profileController.searchProfiles);
router.get("/:id", profileController.ownergetProfile);
router.use(authenticateUser());

// Profile CRUD
router.get("/", profileController.getProfile);
router.put("/", profileController.upsertProfile);
router.patch("/", profileController.partialUpdate);
router.delete("/", profileController.deleteProfile);

// Specialized routes
router.post(
  "/picture",
  uploadProfilePicture,
  profileController.updateProfilePicture
);
router.put("/notifications", profileController.updateNotificationPreferences);
// router.get("/search", profileController.searchProfiles);

export default router;
