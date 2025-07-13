// properties/routes.js
import { Router } from "express";
import { PropertyController } from "./controller.js";
import {
  authenticateUser,
  authorizeAccess,
} from "../../middlewares/authentication.js";
import prisma from "../../config/database.js";

const router = Router();
// Public routes

// Owner access own properties
router.get(
  "/owners-properties/:ownerId",
  authenticateUser(),
  PropertyController.getPublicOwnerProperties
);
router.get(
  "/owners/:ownerId/",
  authenticateUser(),
  (req, res, next) => {
    // First try with create permission
    authorizeAccess("properties", "create")(req, res, (err) => {
      if (err) {
        // If create fails, try with manage permission
        authorizeAccess("properties", "manage")(req, res, next);
      } else {
        next();
      }
    });
  },
  PropertyController.getOwnerProperties
);
// Property owner routes
router.post(
  "/",
  authenticateUser(),
  PropertyController.createProperty
);

router.delete(
  "/:id",
  // authenticateUser(),
  // (req, res, next) => {
  //   // First try with create permission
  //   authorizeAccess("properties", "create")(req, res, (err) => {
  //     if (err) {
  //       // If create fails, try with manage permission
  //       authorizeAccess("properties", "manage")(req, res, next);
  //     } else {
  //       next();
  //     }
  //   });
  // },
  PropertyController.deleteProperty
);
router.put(
  "/:id",
  authenticateUser(),
  // authorizeAccess("properties", "manage"),
  PropertyController.updateProperty
);

// router.put(
//   "/:id",
//   authenticateUser(),
//   authorizeAccess("properties", "manage", {
//     resourceOwnerId: async (req) => {
//       console.log(
//         "Checking the request ===========> \n",
//         req,
//         "\n =========================="
//       );
//       const property = await prisma.property.findUnique({
//         where: { id: req.params.id },
//         select: { ownerId: true },
//       });

//       if (!property) throw new Error("Property not found");
//       return property.ownerId;
//     },
//   }),
//   PropertyController.updateProperty
// );

router.patch(
  "/:id/availability",
  authenticateUser(),
  authorizeAccess("properties", "manage", {
    resourceOwnerId: async (req) => {
      const property = await prisma.property.findUnique({
        where: { id: req.params.id },
      });
      return property?.ownerId;
    },
  }),
  PropertyController.updateAvailability
);

/**
 * @swagger
 * /api/properties/search:
 *   get:
 *     summary: Search properties
 *     tags: [Properties]
 *     parameters:
 *       - in: query
 *         name: query
 *         schema:
 *           type: string
 *         description: Search query text
 *       - in: query
 *         name: latitude
 *         schema:
 *           type: number
 *         description: Latitude for location-based search
 *       - in: query
 *         name: longitude
 *         schema:
 *           type: number
 *         description: Longitude for location-based search
 *       - in: query
 *         name: radius
 *         schema:
 *           type: number
 *           default: 5000
 *         description: Search radius in meters
 *       - in: query
 *         name: minPrice
 *         schema:
 *           type: number
 *         description: Minimum price filter
 *       - in: query
 *         name: maxPrice
 *         schema:
 *           type: number
 *         description: Maximum price filter
 *       - in: query
 *         name: minBedrooms
 *         schema:
 *           type: integer
 *         description: Minimum number of bedrooms
 *       - in: query
 *         name: amenities
 *         schema:
 *           type: array
 *           items:
 *             type: string
 *         description: Required amenities
 *       - in: query
 *         name: propertyType
 *         schema:
 *           type: string
 *         description: Property type filter
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *         description: Results per page
 *     responses:
 *       200:
 *         description: Successful search
 *       400:
 *         description: Invalid parameters
 *       500:
 *         description: Server error
 */
router.get(
  "/search",
  // validateSearchParams,
  PropertyController.searchProperties
);

/**
 * @swagger
 * /api/properties/suggestions:
 *   get:
 *     summary: Get search suggestions
 *     tags: [Properties]
 *     parameters:
 *       - in: query
 *         name: terms
 *         schema:
 *           type: string
 *         description: Comma-separated search terms
 *     responses:
 *       200:
 *         description: Successful operation
 *       400:
 *         description: Missing search terms
 *       500:
 *         description: Server error
 */
router.get("/suggestions", PropertyController.getSearchSuggestions);

/**
 * @swagger
 * /api/properties/reindex/{propertyId}:
 *   post:
 *     summary: Reindex a property
 *     tags: [Properties]
 *     parameters:
 *       - in: path
 *         name: propertyId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID of the property to reindex
 *     responses:
 *       200:
 *         description: Successfully reindexed
 *       400:
 *         description: Missing property ID
 *       500:
 *         description: Server error
 */
router.post("/reindex/:propertyId", PropertyController.reindexProperty);

router.post(
  "/:propertyId/rooms",
  authenticateUser(),
  PropertyController.createRoomSpec
);
router.put(
  "/:propertyId/rooms/:roomId",
  authenticateUser(),
  PropertyController.updateRoonmSpec
);
router.delete(
  "/:propertyId/rooms/:roomId",
  authenticateUser(),
  PropertyController.deleteRoomSpec
);

router.get(
  "/:propertyId/rooms",
  authenticateUser(),
  PropertyController.getRoomSpecsListbypropertyId
);
router.get(
  "/:propertyId/rooms/:roomId",
  authenticateUser(),
  PropertyController.getRoomSpec
);
// Admin routes

router.patch(
  "/:id/status",
  authenticateUser(),
  authorizeAccess("properties", "manage"),
  // validateStatusUpdate, // Add Joi validation if needed
  PropertyController.updatePropertyStatus
);

router.get(
  "/pending/",
  // authenticateUser(),
  // authorizeAccess("properties", "manage"),
  PropertyController.getlistPENDINGProperties
);

// Anyone can approve a property
router.patch(
  "/:id/approve",
  // authenticateUser(),
  // authorizeAccess("properties", "manage"),
  PropertyController.approveProperty
);

// Anyone can reject (delete) a property
router.delete(
  "/:id/reject",
  // authenticateUser(),
  // authorizeAccess("properties", "manage"),
  PropertyController.rejectProperty
);

router.get("/:id", PropertyController.getProperty);
router.get("/", PropertyController.listApprovedProperties);
export default router;
