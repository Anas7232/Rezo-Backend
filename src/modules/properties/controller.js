// properties/controller.js
import { PropertyService } from "./service.js";
import {
  propertySchema,
  validateWithJoi,
  searchParamsSchema,
  suggestionsSchema,
  reindexSchema,
} from "./schema.js";

import {
  ApiError,
  AuthError as AuthorizationError,
  BadRequestError,
  InvalidInputError,
  NotFoundError,
  ValidationError,
} from "../../utils/apiError.js";
import { logger } from "../../config/logger.js";
import Joi from "joi";
import prisma from "../../config/database.js";
export class PropertyController {
  static async createProperty(req, res, next) {
    try {
      // 1. Authentication check
      if (!req.user?.id) {
        throw new AuthError("Authentication required");
      }
      // 2. Validate input with reusable Joi validator
      const { error, value: validatedData } = validateWithJoi(
        propertySchema,
        req.body
      );

      if (error) {
        logger.error("Validation errors:", error.details); // Add this
        throw new BadRequestError(`${error.message}`);
      }

      // 3. Create property
      const property = await PropertyService.createProperty(
        req.user.id,
        validatedData
      );

      // 4. Success response
      res.status(201).json({
        status: "success",
        data: property,
      });
    } catch (error) {
      // Pass to error handling middleware
      next(error);
    }
  }

  static async deleteProperty(req, res, next) {
    try {
      if (!req.user?.id) {
        throw new AuthError("Authentication required");
      }

      // Sanitize and validate property ID
      const rawPropertyId = req.params.id;
      const propertyId = rawPropertyId.replace(/[^0-9a-f-]/gi, "");

      if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          propertyId
        )
      ) {
        throw new InvalidInputError("Invalid property ID format");
      }

      const user = req.user;

      // Authorization check
      if (user.role === "owner") {
        const property = await prisma.property.findUnique({
          where: { id: propertyId },
          select: { ownerId: true },
        });

        if (!property) throw new NotFoundError("Property not found");
        if (property.ownerId !== user.id)
          throw new AuthError("Unauthorized access");
      }

      await PropertyService.deleteProperty(
        propertyId,
        user.role === "admin" ? null : user.id
      );

      res.status(204).end();
    } catch (error) {
      logger.error(`Property deletion failed: ${error.message}`, {
        rawPropertyId: req.params.id,
        // sanitizedId: propertyId,
        userId: req.user?.id,
        stack: error.stack,
      });
      next(error);
    }
  }

  static async getProperty(req, res) {
    try {
      const property = await PropertyService.getProperty(req.params.id);

      res
        .set("Cache-Control", "public, max-age=3600")
        .json(property || { error: "Not found" });
    } catch (error) {
      res.status(error.statusCode || 500).json({
        error: error.message || "Failed to retrieve property",
      });
    }
  }
  static async listApprovedProperties(req, res) {
    try {
      const { page = 1, limit = 10 } = await Joi.object({
        page: Joi.number().min(1).default(1),
        limit: Joi.number().min(1).max(100).default(10),
      }).validateAsync(req.query);

      // Only fetch APPROVED properties for homepage/listings
      const result = await PropertyService.listApprovedProperties({
        page,
        limit,
      });

      res.header("Cache-Control", "public, max-age=300").json(result);
    } catch (error) {
      res.status(error.statusCode || 500).json({
        error: error.message || "Failed to fetch properties",
      });
    }
  }

  // Admin approves a property (status -> APPROVED)
  static async approveProperty(req, res) {
    try {
      const propertyId = req.params.id;
      // Only allow status change to APPROVED
      const property = await PropertyService.updatePropertyStatus(propertyId, "APPROVED");
      res.json({
        status: "success",
        data: property,
        message: "Property approved and indexed",
      });
    } catch (error) {
      res.status(500).json({
        error: "Approval failed",
        details: error.message,
      });
    }
  }

  // Admin rejects a property (delete it)
  static async rejectProperty(req, res) {
    try {
      const propertyId = req.params.id;
      await PropertyService.deleteProperty(propertyId);
      res.json({
        status: "success",
        message: "Property rejected and deleted",
      });
    } catch (error) {
      res.status(500).json({
        error: "Rejection failed",
        details: error.message,
      });
    }
  }

  static async getOwnerProperties(req, res) {
    try {
      const requestedOwnerId = req.params.ownerId || req.user.id;
      const isOwnerRequest = requestedOwnerId === req.user.id;

      // Validate access rights
      if (!isOwnerRequest && req.user.role !== "admin") {
        throw new AuthError("Unauthorized access");
      }

      const result = await PropertyService.getOwnerProperties(
        requestedOwnerId,
        {
          page: Math.max(1, parseInt(req.query.page) || 1),
          limit: Math.min(100, Math.max(1, parseInt(req.query.limit) || 10)),
          isOwnerRequest,
        }
      );

      res.set("Cache-Control", "public, max-age=300").json(result);
    } catch (error) {
      const status = error.statusCode || 500;
      res.status(status).json({
        error: status === 500 ? "Internal server error" : error.message,
      });
    }
  }

  static async getPublicOwnerProperties(req, res) {
    try {
      const result = await PropertyService.getPublicOwnerProperties(
        req.params.ownerId,
        {
          page: Math.max(1, parseInt(req.query.page) || 1),
          limit: Math.min(100, Math.max(1, parseInt(req.query.limit) || 10)),
        }
      );
      res.json(result);
    } catch (error) {
      res.status(error.statusCode || 500).json({
        error: error.message || "Failed to fetch properties",
      });
    }
  }

  static async updateProperty(req, res) {
    try {
      // const data = PropertySchema.partial().parse();
      console.log(
        "Checking the request ===========> \n",
        "User info ====>",
        req.user,
        "Request  body ====>",
        req.body,
        "Request  params ====>",
        req.params,
        "\n =========================="
      );
      const data = req.body;
      const property = await PropertyService.updateProperty(
        req.params.id,
        req.user.id,
        data
      );
      res.json(property);
    } catch (error) {
      res.status(403).json({ error: "Update failed" });
    }
  }

  static async updateAvailability(req, res) {
    try {
      const { id: propertyId } = req.params;
      const availabilitySlots = req.body;

      // Validate property ID format
      if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          propertyId
        )
      ) {
        throw new ValidationError("Invalid property ID format");
      }

      // Validate input structure
      if (!Array.isArray(availabilitySlots) || availabilitySlots.length === 0) {
        throw new ValidationError(
          "Availability data must be a non-empty array"
        );
      }

      // Basic slot validation
      const validatedSlots = availabilitySlots.map((slot, index) => {
        if (
          !slot.startDate ||
          !slot.endDate ||
          typeof slot.basePrice === "undefined"
        ) {
          throw new ValidationError(
            `Slot ${
              index + 1
            } missing required fields (startDate, endDate, basePrice)`
          );
        }

        return {
          ...slot,
          startDate: new Date(slot.startDate),
          endDate: new Date(slot.endDate),
          basePrice: Number(slot.basePrice),
        };
      });

      // Verify property ownership (unless admin)
      if (req.user.role !== "admin") {
        const property = await prisma.property.findUnique({
          where: { id: propertyId },
          select: { ownerId: true },
        });

        // if (!property || property.ownerId !== req.user.id) {
        //   throw new AuthorizationError(
        //     "You don't have permission to update this property's availability"
        //   );
        // }
      }

      // Process update
      const result = await PropertyService.updateAvailability(
        propertyId,
        validatedSlots
      );

      res.json({
        success: true,
        updatedSlots: result.updatedSlots,
        message: "Availability successfully updated",
      });
    } catch (error) {
      const statusCode =
        error.statusCode ||
        (error instanceof ValidationError
          ? 400
          : error instanceof AuthorizationError
          ? 403
          : 500);

      res.status(statusCode).json({
        error: error.message || "Availability update failed",
        ...(process.env.NODE_ENV === "development" && {
          details: error.details,
          stack: error.stack,
        }),
      });
    }
  }

  static async searchProperties(req, res) {
    try {
      // Validate request parameters
      const { error, value } = searchParamsSchema.validate(req.query, {
        abortEarly: false,
        allowUnknown: false,
        convert: true,
      });

      if (error) {
        return res.status(400).json({
          status: "error",
          message: "Validation failed",
          errors: error.details.map((detail) => ({
            field: detail.path.join("."),
            message: detail.message,
          })),
        });
      }

      // Normalize amenities to array
      const normalizedParams = {
        ...value,
        amenities: value.amenities
          ? Array.isArray(value.amenities)
            ? value.amenities
            : [value.amenities]
          : [],
      };

      // Perform search
      const results = await PropertyService.searchProperties(normalizedParams);

      res.json({
        status: "success",
        data: results.data,
        pagination: results.pagination,
      });
    } catch (error) {
      console.error("Property search failed:", error);
      res.status(500).json({
        status: "error",
        message: error.message || "Failed to search properties",
      });
    }
  }

  /**
   * Get search suggestions
   * @param {Object} req - Express request
   * @param {Object} res - Express response
   */
  static async getSearchSuggestions(req, res) {
    try {
      // Validate request parameters
      const { error, value } = suggestionsSchema.validate(req.query);

      if (error) {
        return res.status(400).json({
          status: "error",
          message: error.details[0].message,
        });
      }

      const searchHistory = value.terms.split(",").map((term) => term.trim());
      const suggestions = await PropertyService.getSearchSuggestions(
        searchHistory
      );

      res.json({
        status: "success",
        data: suggestions,
      });
    } catch (error) {
      console.error("Failed to get search suggestions:", error);
      res.status(500).json({
        status: "error",
        message: "Failed to get search suggestions",
      });
    }
  }

  /**
   * Reindex a property in search database
   * @param {Object} req - Express request
   * @param {Object} res - Express response
   */
  static async reindexProperty(req, res) {
    try {
      // Validate request parameters
      const { error, value } = reindexSchema.validate({
        propertyId: req.params.propertyId,
      });

      if (error) {
        return res.status(400).json({
          status: "error",
          message: error.details[0].message,
        });
      }

      await PropertyService.indexProperty(value.propertyId);

      res.json({
        status: "success",
        message: "Property reindexed successfully",
      });
    } catch (error) {
      console.error("Failed to reindex property:", error);
      res.status(500).json({
        status: "error",
        message: error.message || "Failed to reindex property",
      });
    }
  }

  static async getlistPENDINGProperties(req, res) {
    try {
      const { page = 1, limit = 10 } = await Joi.object({
        page: Joi.number().min(1).default(1),
        limit: Joi.number().min(1).max(100).default(10),
      }).validateAsync(req.query);

      const result = await PropertyService.listofPENDINGProperties({
        page,
        limit,
      });

      res.header("Cache-Control", "public, max-age=300").json(result);
    } catch (error) {
      res.status(error.statusCode || 500).json({
        error: error.message || "Failed to fetch properties",
      });
    }
  }

  // Property Controller
  static async updatePropertyStatus(req, res) {
    try {
      const { status } = req.body;
      const propertyId = req.params.id;

      // Validate status input  PENDING

      const validStatuses = ["PENDING", "APPROVED", "REJECTED", "ARCHIVED"];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({ error: "Invalid status value" });
      }

      // Check property exists
      const existing = await prisma.property.findUnique({
        where: { id: propertyId },
      });
      if (!existing) {
        return res.status(404).json({ error: "Property not found" });
      }

      // Update status and handle indexing
      const property = await PropertyService.updatePropertyStatus(
        propertyId,
        status
      );

      res.json({
        status: "success",
        data: property,
        message:
          status === "APPROVED"
            ? "Property approved and indexed"
            : "Status updated",
      });
    } catch (error) {
      console.error("Update Error:", error);
      res.status(500).json({
        error: "Status update failed",
        details: error.message,
      });
    }
  }

  static async createRoomSpec(req, res) {
    try {
      const { propertyId } = req.params;
      const { roomType, bedCount, description, size } = req.body;

      if (
        roomType == null ||
        bedCount == null ||
        description == null ||
        size == null
      ) {
        throw new ValidationError(
          "Fields roomType, bedCount, description, and size are required"
        );
      }

      const data = {
        type: roomType,
        count: bedCount,
        description,
        sizeSqft: size,
      };

      // Create room specification
      const roomSpec = await PropertyService.CreateRoomSpec(propertyId, data);

      res.status(201).json({
        status: "success",
        data: roomSpec,
      });
    } catch (error) {
      console.error("Failed to create room specification:", error);
      res.status(500).json({
        status: "error",
        message: error.message || "Failed to create room specification",
      });
    }
  }

  static async updateRoonmSpec(req, res) {
    try {
      const { propertyId, roomId } = req.params;
      const { roomType, bedCount, description, size } = req.body;

      // Validate input data
      if (
        roomType == null ||
        bedCount == null ||
        description == null ||
        size == null
      ) {
        throw new ValidationError(
          "Fields roomType, bedCount, description, and size are required"
        );
      }

      const data = {
        type: roomType,
        count: bedCount,
        description,
        sizeSqft: size,
      };

      // Create room specification
      const roomSpec = await PropertyService.updateRoomSpec(
        propertyId,
        roomId,
        data
      );

      res.status(201).json({
        status: "success",
        data: roomSpec,
      });
    } catch (error) {
      console.error("Failed to create room specification:", error);
      res.status(500).json({
        status: "error",
        message: error.message || "Failed to create room specification",
      });
    }
  }

  static async deleteRoomSpec(req, res) {
    try {
      const { propertyId, roomId } = req.params;

      // Delete room specification
      await PropertyService.deleteRoomSpec(propertyId, roomId);

      res.status(204).json({
        status: "success",
        message: "Room specification deleted successfully",
      });
    } catch (error) {
      console.error("Failed to delete room specification:", error);
      res.status(500).json({
        status: "error",
        message: error.message || "Failed to delete room specification",
      });
    }
  }

  static async getRoomSpec(req, res) {
    try {
      const { roomId } = req.params;

      // Fetch room specifications
      const roomSpecs = await PropertyService.getRoomSpec(roomId);

      res.status(200).json({
        status: "success",
        data: roomSpecs,
      });
    } catch (error) {
      console.error("Failed to fetch room specifications:", error);
      res.status(500).json({
        status: "error",
        message: error.message || "Failed to fetch room specifications",
      });
    }
  }
  static async getRoomSpecsListbypropertyId(req, res) {
    try {
      const { propertyId } = req.params;

      // Fetch room specifications
      const roomSpecs = await PropertyService.getRoomSpecListbyPropertyId(
        propertyId
      );

      res.status(200).json({
        status: "success",
        data: roomSpecs,
      });
    } catch (error) {
      console.error("Failed to fetch room specifications:", error);
      res.status(500).json({
        status: "error",
        message: error.message || "Failed to fetch room specifications",
      });
    }
  }
}
