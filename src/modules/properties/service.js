// src/modules/properties/service.js
import prisma from "../../config/database.js";
import { PricingService } from "../../utils/pricing.js";
import {
  DatabaseError,
  ValidationError,
  ConflictError,
  NotFoundError,
  InvalidInputError,
  AuthError,
} from "../../utils/apiError.js";
import { geoJSON } from "../../utils/geospatial.js";
import redis from "../../config/redis.js";
import { Prisma } from "@prisma/client";
import { validate as isValidUUID } from "uuid";
import PropertySearch from "../../models/PropertyDetails.js";

export class PropertyService {
  /**
   * Create new property with full transactional safety
   */
  static async createProperty(ownerId, propertyData) {
    try {
      const property = await prisma.$transaction(async (tx) => {
        const property = await tx.property.create({
          data: {
            ownerId,
            status: "PENDING",
            ...this.sanitizePropertyData(propertyData),
            photos: propertyData.photos || [],
            virtualTours: propertyData.virtualTours || [],
          },
          include: { amenities: true, roomSpecs: true },
        });
        // Create related data (using arrow function)
        if (propertyData.amenities || propertyData.roomSpecs) {
          await this.createRelationalData(tx, property.id, propertyData);
        }

        // await this.createRelationalData(tx, property.id, propertyData);
        return property;
      });

      await this.cacheProperty(property);
      return property;
    } catch (error) {
      this.handleDatabaseError(error, "Property creation failed");
    }
  }

  /**
   * Optimized property retrieval with deep relations
   */
  static async getProperty(propertyId) {
    const CACHE_TTL = 3600; // 1 hour in seconds
    const cacheKey = `property:${propertyId}`;
    if (!isValidUUID(propertyId)) {
      throw new Error(`Invalid property ID format: ${propertyId}`);
    }
    try {
      // 1. Check cache first
      const cachedData = await redis.get(cacheKey);
      if (cachedData) {
        try {
          return JSON.parse(cachedData);
        } catch (parseError) {
          await redis.del(cacheKey);
          throw new DatabaseError("Invalid cache data format");
        }
      }

      // 2. Cache miss - query database
      const property = await prisma.property.findUnique({
        where: { id: propertyId },
        include: {
          amenities: true,
          roomSpecs: true,
          availability: {
            where: { isAvailable: true },
            orderBy: { startDate: "asc" },
          },
          _count: {
            select: { bookings: true, reviews: true },
          },
        },
      });

      if (!property) {
        // Cache negative result to prevent DB queries for missing properties
        await redis.setex(cacheKey, CACHE_TTL, JSON.stringify(null));
        throw new NotFoundError("Property not found");
      }

      // 3. Enrich data
      const enrichedProperty = this.enrichPropertyData(property);

      // 4. Update cache async to avoid blocking response
      redis
        .setex(cacheKey, CACHE_TTL, JSON.stringify(enrichedProperty))
        .catch((err) => console.error("Cache update failed:", err));

      return enrichedProperty;
    } catch (error) {
      if (error instanceof NotFoundError) throw error;
      this.handleDatabaseError(error, "Property retrieval failed");
    }
  }

  /**
   * Retrieves a paginated list of approved properties from the database,
   * including related amenities and room specifications. Results are cached
   * for improved performance.
   *
   * @async
   * @function
   * @param {Object} params - The parameters for the query.
   * @param {number} params.page - The current page number for pagination.
   * @param {number} params.limit - The number of items per page.
   * @returns {Promise<Object>} A promise that resolves to an object containing
   * the list of approved properties and metadata about pagination.
   * @throws {Error} Throws an error if the database query fails.
   *
   * @example
   * const result = await listApprovedProperties({ page: 1, limit: 10 });
   * console.log(result.data); // Array of approved properties
   * console.log(result.meta); // Pagination metadata
   */
  static async listApprovedProperties({ page, limit }) {
    const CACHE_TTL = 300; // 5 minutes
    const cacheKey = `approved_properties:page:${page}:limit:${limit}`;

    try {
      const cached = await redis.get(cacheKey);
      if (cached) return JSON.parse(cached);

      const [properties, total] = await prisma.$transaction([
        prisma.property.findMany({
          where: { status: "APPROVED" }, // Only approved properties
          include: {
            amenities: { select: { id: true, name: true } },
            roomSpecs: { select: { type: true, count: true } },
            owner: {
              select: {
                profile: {
                  select: {
                    firstName: true,
                    lastName: true,
                    phone: true,
                    avatarUrl: true,
                  },
                },
              },
            },
          },
          skip: (page - 1) * limit,
          take: limit,
          orderBy: { createdAt: "desc" },
        }),
        prisma.property.count({ where: { status: "APPROVED" } }),
      ]);

      const result = {
        data: properties,
        meta: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      };

      redis.setex(cacheKey, CACHE_TTL, JSON.stringify(result));
      return result;
    } catch (error) {
      this.handleDatabaseError(error, "Failed to list approved properties");
    }
  }

  /**
   * Retrieves a paginated list of properties owned by a specific owner.
   *
   * @param {string} ownerId - The UUID of the owner whose properties are to be fetched.
   * @param {Object} [pagination={}] - Pagination options.
   * @param {number} [pagination.page=1] - The page number to retrieve.
   * @param {number} [pagination.limit=10] - The number of items per page.
   * @returns {Promise<Object>} A promise that resolves to an object containing the properties data and metadata.
   * @throws {ValidationError} If the provided ownerId is not a valid UUID.
   * @throws {Error} If there is an issue with the database query or cache operation.
   *
   * @example
   * const properties = await getOwnerProperties('123e4567-e89b-12d3-a456-426614174000', { page: 2, limit: 5 });
   * console.log(properties.data); // Array of properties
   * console.log(properties.meta); // Pagination metadata
   */

  static async getOwnerProperties(
    ownerId,
    { page = 1, limit = 10, isOwnerRequest = false } = {}
  ) {
    const CACHE_TTL = 300;
    const accessType = isOwnerRequest ? "owner" : "public";
    const cacheKey = `properties:${ownerId}:${accessType}:page_${page}_limit_${limit}`;

    try {
      // Validation
      if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          ownerId
        )
      ) {
        throw new ValidationError("Invalid owner ID format");
      }

      // Cache check
      const cached = await redis.get(cacheKey);
      if (cached) return JSON.parse(cached);

      // Dynamic filtering
      const statusFilter = isOwnerRequest ? { not: "ARCHIVED" } : "APPROVED";

      // Database operations
      const [properties, total] = await prisma.$transaction([
        prisma.property.findMany({
          where: { ownerId, status: statusFilter },
          include: {
            amenities: { select: { name: true } },
            roomSpecs: { select: { type: true, count: true } },
            _count: { select: { bookings: true, reviews: true } },
          },
          skip: (page - 1) * limit,
          take: limit,
          orderBy: { createdAt: "desc" },
        }),
        prisma.property.count({ where: { ownerId, status: statusFilter } }),
      ]);

      // Prepare response
      const result = {
        data: properties.map((p) => ({
          ...p,
          stats: p._count,
          featuredPhoto: p.photos?.[0],
        })),
        meta: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      };

      // Cache with error handling
      redis
        .setex(cacheKey, CACHE_TTL, JSON.stringify(result))
        .catch((err) => console.error("Cache Error:", err));

      return result;
    } catch (error) {
      this.handleDatabaseError(error, "Property fetch failed");
    }
  }

  /**
   * Fetches a paginated list of public properties for a given owner.
   *
   * This method retrieves properties that are approved and not deleted,
   * with support for caching and pagination. It also validates the owner ID format.
   *
   * @param {string} ownerId - The UUID of the property owner.
   * @param {Object} options - Pagination options.
   * @param {number} [options.page=1] - The page number to retrieve.
   * @param {number} [options.limit=10] - The number of properties per page.
   * @returns {Promise<Object>} A promise that resolves to an object containing:
   *   - `data` (Array): The list of properties with details.
   *   - `meta` (Object): Metadata about the pagination (page, limit, total, totalPages).
   * @throws {ValidationError} If the ownerId is not a valid UUID.
   * @throws {Error} If there is an issue with the database or caching.
   */
  static async getPublicOwnerProperties(ownerId, { page = 1, limit = 10 }) {
    const CACHE_TTL = 300; // 5 minutes
    const cacheKey = `public_properties:${ownerId}:page_${page}_limit_${limit}`;

    try {
      // Validate UUID format
      if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          ownerId
        )
      ) {
        throw new ValidationError("Invalid owner ID format");
      }

      // Check cache
      const cached = await redis.get(cacheKey);
      if (cached) return JSON.parse(cached);

      // Database query
      const [properties, total] = await prisma.$transaction([
        prisma.property.findMany({
          where: {
            ownerId,
            status: "APPROVED",
            deletedAt: null,
          },
          select: {
            id: true,
            title: true,
            description: true,
            photos: true,
            amenities: { select: { name: true } },
            roomSpecs: { select: { type: true, count: true } },
            _count: { select: { reviews: true } },
          },
          skip: (page - 1) * limit,
          take: limit,
          orderBy: { createdAt: "desc" },
        }),
        prisma.property.count({
          where: {
            ownerId,
            status: "APPROVED",
            deletedAt: null,
          },
        }),
      ]);

      // Transform data
      const result = {
        data: properties.map((p) => ({
          ...p,
          rating:
            p._count.reviews > 0 ? p.totalRating / p._count.reviews : null,
          featuredPhoto: p.photos?.[0],
        })),
        meta: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      };

      // Cache with error handling
      redis
        .setex(cacheKey, CACHE_TTL, JSON.stringify(result))
        .catch((err) => console.error("Cache Error:", err));

      return result;
    } catch (error) {
      this.handleDatabaseError(error, "Failed to fetch public properties");
    }
  }

  /**
   * Sophisticated availability management with conflict detection
   */

  static async updateAvailability(propertyId, availabilitySlots) {
    try {
      // Validate input structure
      if (!availabilitySlots?.length) {
        throw new ValidationError("At least one availability slot required");
      }

      return await prisma.$transaction(async (tx) => {
        // 1. Validate slots before any DB operations
        const validatedSlots = availabilitySlots.map((slot) => {
          const startDate = new Date(slot.startDate);
          const endDate = new Date(slot.endDate);

          if (isNaN(startDate) || isNaN(endDate)) {
            throw new ValidationError(
              "Invalid date format in availability slots"
            );
          }
          if (startDate >= endDate) {
            throw new ValidationError("Start date must be before end date");
          }
          if (typeof slot.basePrice !== "number" || slot.basePrice < 0) {
            throw new ValidationError("Invalid base price");
          }

          return {
            ...slot,
            startDate,
            endDate,
            price: PricingService.calculateDynamicPrice(
              slot.basePrice,
              slot.dates
            ),
          };
        });

        // 2. Check for slot overlaps in input
        const sortedSlots = validatedSlots.sort(
          (a, b) => a.startDate - b.startDate
        );
        for (let i = 1; i < sortedSlots.length; i++) {
          if (sortedSlots[i].startDate < sortedSlots[i - 1].endDate) {
            throw new ConflictError(
              "Availability slots cannot overlap each other"
            );
          }
        }

        // 3. Find overlapping bookings
        const bookingConflict = await tx.booking.findFirst({
          where: {
            propertyId,
            status: { not: "CANCELLED" },
            OR: validatedSlots.map((slot) => ({
              AND: [
                { startDate: { lt: slot.endDate } },
                { endDate: { gt: slot.startDate } },
              ],
            })),
          },
          select: { id: true, startDate: true, endDate: true },
        });

        if (bookingConflict) {
          throw new ConflictError(
            `Conflicts with booking ${bookingConflict.id} ` +
              `(${bookingConflict.startDate.toISOString()} - ` +
              `${bookingConflict.endDate.toISOString()})`
          );
        }

        // 4. Atomic update in batches
        await tx.availability.deleteMany({ where: { propertyId } });

        const BATCH_SIZE = 100;
        for (let i = 0; i < validatedSlots.length; i += BATCH_SIZE) {
          await tx.availability.createMany({
            data: validatedSlots.slice(i, i + BATCH_SIZE).map((slot) => ({
              propertyId,
              startDate: slot.startDate,
              endDate: slot.endDate,
              price: slot.price,
              isAvailable: slot.isAvailable,
            })),
            skipDuplicates: true,
          });
        }

        // 5. Update search index after successful transaction
        // await SearchIndexService.refreshPricing(propertyId);

        return { success: true, updatedSlots: validatedSlots.length };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        this.handleDatabaseError(error, "Availability update failed");
      }
      throw error;
    }
  }

  /**
   * Safely delete property with archival pattern
   */
  static async deleteProperty(propertyId, ownerId = null) {
    try {
      // 1. Check if property exists
      const property = await prisma.property.findUnique({ where: { id: propertyId } });
      if (!property) return { success: true, message: "Property already deleted" };
      // Remove AuthError check for ownerId
      // if (ownerId && property.ownerId !== ownerId) throw new AuthError("Unauthorized");

      // 2. Cascade delete all related records
      await prisma.amenity.deleteMany({ where: { propertyId } });
      await prisma.roomSpec.deleteMany({ where: { propertyId } });
      await prisma.booking.deleteMany({ where: { propertyId } });
      await prisma.availability.deleteMany({ where: { propertyId } });
      await prisma.review.deleteMany({ where: { propertyId } });
      await prisma.payment.deleteMany({ where: { propertyId } });
      await prisma.rentalDetails.deleteMany({ where: { propertyId } });
      await prisma.saleDetails.deleteMany({ where: { propertyId } });
      // Add any other related tables here if needed

      // 3. Delete the property itself
      await prisma.property.delete({ where: { id: propertyId } });
      return { success: true };
    } catch (error) {
      console.error("Error in deleteProperty:", error);
      throw new Error("Property deletion failed");
    }
  }

  /**
   * Full property update with complex data relationships
   */
  static async updateProperty(propertyId, ownerId, updateData) {
    const CACHE_TTL = 3600; // 1 hour
    try {
      // Verify property ownership first
      const existingProperty = await prisma.property.findUnique({
        where: { id: propertyId },
        select: { ownerId: true, status: true },
      });

      if (!existingProperty) throw new NotFoundError("Property not found");
      // if (existingProperty.ownerId !== ownerId) {
      //   throw new AuthError("Unauthorized property update");
      // }

      const updatedProperty = await prisma.$transaction(async (tx) => {
        //  Core property update
        const property = await tx.property.update({
          where: { id: propertyId },
          data: this.sanitizePropertyData(updateData),
          include: { amenities: true, roomSpecs: true },
        });

        //  Conditional relational data updates
        const updateOperations = [];

        if (updateData.amenities) {
          updateOperations.push(
            tx.amenity.deleteMany({ where: { propertyId } }),
            tx.amenity.createMany({
              data: updateData.amenities.map((amenity) => ({
                propertyId,
                ...amenity,
              })),
              skipDuplicates: true,
            })
          );
        }

        if (updateData.roomSpecs) {
          updateOperations.push(
            tx.roomSpec.deleteMany({ where: { propertyId } }),
            tx.roomSpec.createMany({
              data: updateData.roomSpecs.map((spec) => ({
                propertyId,
                ...spec,
              })),
            })
          );
        }

        if (updateOperations.length > 0) {
          await Promise.all(updateOperations);
        }

        return property;
      });

      //  Post-update operations
      await Promise.all([
        redis.del(`property:${propertyId}`),
        SearchIndexService.update(propertyId),
        redis.setex(
          `property:${propertyId}`,
          CACHE_TTL,
          JSON.stringify(this.enrichPropertyData(updatedProperty))
        ),
      ]);

      return updatedProperty;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        this.handleDatabaseError(error, "Database update failed");
      }
      throw error;
    }
  }

  // --- Helper Methods ---

  static sanitizePropertyData(data) {
    // Handle location data - support both old format and new format
    let locationData;
    if (data.location && typeof data.location === 'object') {
      if (data.location.coordinates && Array.isArray(data.location.coordinates)) {
        // New format: { coordinates: [lng, lat], type: "Point" }
        const [lng, lat] = data.location.coordinates;
        locationData = geoJSON.forDatabase(parseFloat(lat), parseFloat(lng));
      } else if (data.location.lat && data.location.lng) {
        // Old format: { lat, lng }
        locationData = geoJSON.forDatabase(
          parseFloat(data.location.lat),
          parseFloat(data.location.lng)
        );
      } else {
        // Fallback to default location
        locationData = geoJSON.forDatabase(31.5204, 74.3587); // Lahore default
      }
    } else {
      // Fallback to default location
      locationData = geoJSON.forDatabase(31.5204, 74.3587); // Lahore default
    }

    return {
      title: data.title,
      description: data.description,
      basePrice: data.basePrice,
      currency: data.currency,
      location: locationData,
      address: data.address,
      city: data.city,
      state: data.state,
      country: data.country,
      postalCode: data.postalCode,
      maxGuests: data.maxGuests,
      minStay: data.minStay,
      maxStay: data.maxStay,
      houseRules: data.houseRules,
      photos: data.photos || [],
      virtualTours: data.virtualTours || [],
      sizeSqft: data.sizeSqft,
      listingType: data.listingType,
    };
  }

  static async cacheProperty(property) {
    const cacheKey = `property:${property.id}`;
    const enriched = this.enrichPropertyData(property);
    await redis.setex(cacheKey, 3600, JSON.stringify(enriched));
  }

  static handleDatabaseError(error, context) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new DatabaseError(`${context}: ${error.meta?.message}`);
    }
    if (error instanceof Prisma.PrismaClientValidationError) {
      throw new ValidationError("Invalid data structure provided");
    }
    throw error;
  }

  static enrichPropertyData(property) {
    return {
      ...property,
      stats: {
        bookings: property._count?.bookings || 0,
        reviews: property._count?.reviews || 0,
      },
      featuredPhoto: property.photos?.[0] || null,
    };
  }

  static async createRelationalData(tx, propertyId, propertyData) {
    // Implementation of relational data creation
    // Example:
    if (propertyData.amenities?.length) {
      await tx.amenity.createMany({
        data: propertyData.amenities.map((name) => ({
          propertyId,
          name,
        })),
      });
    }
  }

  /**
   * Full-text search properties with filters
   * @param {Object} params - Search parameters
   * @param {string} params.query - Search query string
   * @param {number} params.latitude - Location latitude
   * @param {number} params.longitude - Location longitude
   * @param {number} params.radius - Search radius in meters
   * @param {number} params.minPrice - Minimum price filter
   * @param {number} params.maxPrice - Maximum price filter
   * @param {number} params.minBedrooms - Minimum bedrooms
   * @param {string[]} params.amenities - Required amenities
   * @param {string} params.propertyType - Property type filter
   * @param {number} params.page - Pagination page
   * @param {number} params.limit - Results per page
   * @returns {Promise<Object>} Search results
   */
  static async searchProperties({
    query,
    latitude,
    longitude,
    radius = 5000,
    minPrice,
    maxPrice,
    minBedrooms,
    amenities = [],
    propertyType,
    page = 1,
    limit = 20,
  }) {
    try {
      // Build the MongoDB search query
      const mongoQuery = {};
      const prismaWhere = {};

      // Text search
      if (query) {
        mongoQuery.$text = { $search: query };
      }

      // Location-based search
      if (latitude && longitude) {
        mongoQuery.location = {
          $near: {
            $geometry: {
              type: "Point",
              coordinates: [longitude, latitude],
            },
            $maxDistance: radius,
          },
        };

        // Add to Prisma where for additional filtering
        prismaWhere.location = {
          path: ["lat", "lng"],
          equals: [latitude, longitude],
        };
      }

      // Price range filter
      if (minPrice || maxPrice) {
        prismaWhere.basePrice = {};
        if (minPrice) prismaWhere.basePrice.gte = new Prisma.Decimal(minPrice);
        if (maxPrice) prismaWhere.basePrice.lte = new Prisma.Decimal(maxPrice);
      }

      // Bedrooms filter
      if (minBedrooms) {
        prismaWhere.roomSpecs = {
          some: {
            type: "BEDROOM",
            count: { gte: minBedrooms },
          },
        };
      }

      // Amenities filter
      if (amenities.length > 0) {
        prismaWhere.amenities = {
          some: {
            name: { in: amenities },
          },
        };
      }

      // Property type filter
      if (propertyType) {
        prismaWhere.roomSpecs = {
          some: {
            type: propertyType,
          },
        };
      }
      this.syncAllApprovedProperties();
      // First search in MongoDB for performance
      const mongoResults = await PropertySearch.find(mongoQuery)
        .skip((page - 1) * limit)
        .limit(limit)
        .lean();

      // Then get full details from Prisma
      const propertyIds = mongoResults.map((p) => p.propertyId);
      const prismaResults = await prisma.property.findMany({
        where: {
          ...prismaWhere,
          id: { in: propertyIds },
        },
        include: {
          roomSpecs: true,
          amenities: true,
          reviews: {
            select: {
              rating: true,
            },
          },
          _count: {
            select: {
              bookings: true,
              reviews: true,
            },
          },
        },
        skip: (page - 1) * limit,
        take: limit,
      });

      // Calculate average ratings
      const resultsWithStats = prismaResults.map((property) => {
        const avgRating =
          property.reviews.reduce((sum, review) => sum + review.rating, 0) /
          (property.reviews.length || 1);

        return {
          ...property,
          quickStats: {
            rating: avgRating,
            reviewCount: property._count.reviews,
            bookedCount: property._count.bookings,
          },
        };
      });

      // Get total count for pagination
      const totalCount = await PropertySearch.countDocuments(mongoQuery);

      return {
        data: resultsWithStats,
        pagination: {
          total: totalCount,
          page,
          limit,
          totalPages: Math.ceil(totalCount / limit),
        },
      };
    } catch (error) {
      console.error("Property search failed:", error);
      throw new Error("Failed to search properties");
    }
  }

  /**
   * Update property status and handle search indexing
   * @param {string} propertyId
   * @param {string} status
   * @returns {Promise<Property>}
   */
  static async updatePropertyStatus(propertyId, status) {
    const property = await prisma.property.update({
      where: { id: propertyId },
      data: { status },
      include: {
        roomSpecs: true,
        amenities: true,
      },
    });

    // Clear relevant caches when status changes
    await this.clearPropertyCaches(propertyId, status);

    // Automatically index when status changes to APPROVED
    if (status === "APPROVED") {
      await this.indexProperty(propertyId);
    } else if (status !== "APPROVED") {
      // Remove from search index if status changes from APPROVED
      await PropertySearch.deleteOne({ propertyId });
    }

    return property;
  }

  /**
   * Clear relevant caches when property status changes
   * @param {string} propertyId
   * @param {string} status
   */
  static async clearPropertyCaches(propertyId, status) {
    try {
      // Clear individual property cache
      await redis.del(`property:${propertyId}`);

      // Clear approved properties cache (since status changed)
      const approvedCacheKeys = await redis.keys('approved_properties:*');
      if (approvedCacheKeys.length > 0) {
        await redis.del(...approvedCacheKeys);
      }

      // Clear pending properties cache (since status changed)
      const pendingCacheKeys = await redis.keys('pending_properties:*');
      if (pendingCacheKeys.length > 0) {
        await redis.del(...pendingCacheKeys);
      }

      // Get property owner ID to clear owner-specific caches
      const property = await prisma.property.findUnique({
        where: { id: propertyId },
        select: { ownerId: true }
      });

      if (property?.ownerId) {
        const ownerCacheKeys = await redis.keys(`properties:${property.ownerId}:*`);
        if (ownerCacheKeys.length > 0) {
          await redis.del(...ownerCacheKeys);
        }
      }

      console.log(`Cleared caches for property ${propertyId} status change to ${status}`);
    } catch (error) {
      console.error('Error clearing property caches:', error);
    }
  }

  /**
   * Index a property in the search database with enhanced data
   * @param {string} propertyId - Property ID to index
   */
  static async indexProperty(propertyId) {
    try {
      const property = await prisma.property.findUnique({
        where: { id: propertyId },
        include: {
          roomSpecs: true,
          amenities: true,
          reviews: { select: { rating: true } },
          _count: { select: { bookings: true } },
        },
      });

      if (!property) throw new Error("Property not found");
      if (property.status !== "APPROVED") {
        throw new Error("Only APPROVED properties can be indexed");
      }

      // Calculate statistics
      const avgRating = property.reviews.length
        ? property.reviews.reduce((sum, r) => sum + r.rating, 0) /
          property.reviews.length
        : 0;

      // Prepare comprehensive search document
      const searchDoc = {
        propertyId: property.id,
        title: property.title,
        description: property.description,
        basePrice: property.basePrice,
        currency: property.currency,
        location: {
          type: "Point",
          coordinates: property.location.coordinates || [
            property.location.lng,
            property.location.lat,
          ],
        },
        address: property.address,
        maxGuests: property.maxGuests,
        amenities: property.amenities.map((a) => a.name),
        propertyType: property.roomSpecs.find((r) => r.type !== "BEDROOM")
          ?.type,
        bedrooms:
          property.roomSpecs.find((r) => r.type === "BEDROOM")?.count || 0,
        photos: property.photos,
        stats: {
          rating: avgRating,
          reviewCount: property.reviews.length,
          bookedCount: property._count.bookings,
        },
        createdAt: property.createdAt,
        updatedAt: new Date(),
      };

      // Upsert with atomic operation
      await PropertySearch.updateOne(
        { propertyId },
        { $set: searchDoc },
        { upsert: true }
      );

      return searchDoc;
    } catch (error) {
      console.error("Indexing failed:", error);
      throw new Error(`Indexing failed: ${error.message}`);
    }
  }

  /**
   * Get property suggestions based on search history
   * @param {string[]} searchHistory - Array of previous search terms
   * @param {number} limit - Number of suggestions to return
   */
  static async getSearchSuggestions(searchHistory, limit = 5) {
    try {
      const suggestions = await PropertySearch.aggregate([
        {
          $match: {
            $text: { $search: searchHistory.join(" ") },
          },
        },
        {
          $project: {
            title: 1,
            score: { $meta: "textScore" },
          },
        },
        { $sort: { score: -1 } },
        { $limit: limit },
      ]);

      return suggestions.map((s) => s.title);
    } catch (error) {
      console.error("Failed to get search suggestions:", error);
      return [];
    }
  }

  static async listofPENDINGProperties({ page = 1, limit = 10 }) {
    const CACHE_TTL = 300; // 5 minutes
    const cacheKey = `pending_properties:page:${page}:limit:${limit}`;

    try {
      // Check cache first
      const cached = await redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }

      const [properties, total] = await prisma.$transaction([
        prisma.property.findMany({
          where: { status: "PENDING" },
          include: {
            amenities: { select: { id: true, name: true } },
            roomSpecs: { select: { type: true, count: true } },
            owner: {
              select: {
                profile: {
                  select: {
                    firstName: true,
                    lastName: true,
                    phone: true,
                    avatarUrl: true,
                  },
                },
              },
            },
          },
          skip: (page - 1) * limit,
          take: limit,
          orderBy: { createdAt: "desc" },
        }),
        prisma.property.count({ where: { status: "PENDING" } }),
      ]);

      const result = {
        data: properties,
        meta: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      };

      // Cache the result
      redis.setex(cacheKey, CACHE_TTL, JSON.stringify(result));
      return result;
    } catch (error) {
      this.handleDatabaseError(error, "Failed to list pending properties");
    }
  }

  static async syncAllApprovedProperties() {
    try {
      const approvedProperties = await prisma.property.findMany({
        where: { status: "APPROVED" },
        select: { id: true },
      });

      const results = await Promise.allSettled(
        approvedProperties.map((p) => PropertyService.indexProperty(p.id))
      );

      const successful = results.filter((r) => r.status === "fulfilled").length;
      const failed = results.filter((r) => r.status === "rejected").length;

      console.log(`Search index sync complete. 
        Successful: ${successful}, Failed: ${failed}`);

      return { successful, failed };
    } catch (error) {
      console.error("Bulk sync failed:", error);
      throw error;
    }
  }

  static async CreateRoomSpec(propertyId, roomSpecData) {
    try {
      const roomSpec = await prisma.roomSpec.create({
        data: {
          propertyId,
          ...roomSpecData,
        },
      });

      // Update the search index if necessary
      await PropertyService.indexProperty(propertyId);

      return roomSpec;
    } catch (error) {
      this.handleDatabaseError(error, "Failed to create room specification");
    }
  }
  static async updateRoomSpec(propertyId, roomSpecId, roomSpecData) {
    try {
      // check proprty
      const property = await prisma.property.findUnique({
        where: { id: propertyId },
        select: { id: true },
      });
      if (!property) throw new NotFoundError("Property not found");
      // check room spec
      const roomSpec = await prisma.roomSpec.findUnique({
        where: { id: roomSpecId },
        select: { id: true },
      });
      if (!roomSpec) throw new NotFoundError("Room specification not found");
      const UpdateRoomSpec = await prisma.roomSpec.update({
        where: { id: roomSpecId },
        data: roomSpecData,
      });

      // Update the search index if necessary
      await PropertyService.indexProperty(propertyId);

      return UpdateRoomSpec;
    } catch (error) {
      this.handleDatabaseError(error, "Failed to update room specification");
    }
  }
  static async deleteRoomSpec(propertyId, roomSpecId) {
    try {
      // check proprty
      const property = await prisma.property.findUnique({
        where: { id: propertyId },
        select: { id: true },
      });
      if (!property) throw new NotFoundError("Property not found");
      // check room spec
      const roomSpec = await prisma.roomSpec.findUnique({
        where: { id: roomSpecId },
        select: { id: true },
      });
      if (!roomSpec) throw new NotFoundError("Room specification not found");

      const deletedRoomSpec = await prisma.roomSpec.delete({
        where: { id: roomSpecId },
      });

      // Update the search index if necessary
      await PropertyService.indexProperty(propertyId);

      return deletedRoomSpec;
    } catch (error) {
      this.handleDatabaseError(error, "Failed to delete room specification");
    }
  }
  static async getRoomSpecListbyPropertyId(propertyId) {
    const roomSpecs = await prisma.roomSpec.findMany({
      where: { propertyId },
      select: {
        id: true,
        type: true,
        count: true,
        description: true,
        sizeSqft: true,
      },
    });

    return roomSpecs;
  }
  static async getRoomSpec(roomSpecId) {
    try {
      console.log("RoomSpec ID in service:", roomSpecId);
      const roomSpecs = await prisma.roomSpec.findUnique({
        where: { id: roomSpecId },
        select: {
          id: true,
          type: true,
          count: true,
          description: true,
          sizeSqft: true,
        },
      });

      return roomSpecs;
    } catch (error) {
      this.handleDatabaseError(error, "Failed to fetch room specifications");
    }
  }
}
