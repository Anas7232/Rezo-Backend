import { Prisma } from "@prisma/client";
import prisma from "../../config/database.js";
import { uploadToCloudinary } from "../../utils/fileStorage.js";
import { profileSchema, profileUpdateSchema } from "./schema.js";

export class ProfileService {
  /**
   * Create or update user profile with validation
   * @param {Object} params
   * @param {string} params.userId - User ID
   * @param {Object} params.profileData - Profile data
   * @returns {Promise<Object>} Created/updated profile
   */
  static async upsertProfile({ userId, profileData }) {
    // Validate input data
    const { error, value } = profileSchema.validate(profileData);
    if (error) {
      throw new Error(
        `Validation error: ${error.details.map((d) => d.message).join(", ")}`
      );
    }

    return prisma.profile.upsert({
      where: { userId },
      create: {
        userId,
        ...value,
        updatedAt: new Date(),
      },
      update: {
        ...value,
        updatedAt: new Date(),
      },
    });
  }

  /**
   * Partial profile update with validation
   * @param {string} userId
   * @param {Object} updateData
   * @returns {Promise<Object>} Updated profile
   */
  static async partialUpdate(userId, updateData) {
    const { error, value } = profileUpdateSchema.validate(updateData);
    if (error) {
      throw new Error(
        `Validation error: ${error.details.map((d) => d.message).join(", ")}`
      );
    }

    return prisma.profile.update({
      where: { userId },
      data: {
        ...value,
        updatedAt: new Date(),
      },
    });
  }

  /**
   * Get profile by user ID
   * @param {string} userId
   * @returns {Promise<Object|null>} Profile data
   */

  static async getProfile(userId) {
    // Validate userId input
    if (!userId || typeof userId !== "string") {
      throw new Error("Invalid userId: must be a non-empty string");
    }

    try {
      // First check if user exists
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          username: true,
          isActive: true,
          isVerified: true,
          roles: {
            select: {
              role: {
                select: {
                  name: true,
                },
              },
            },
          },
        },
      });

      if (!user) {
        throw new Error("User not found");
      }

      // Then check for profile
      const profile = await prisma.profile.findUnique({
        where: { userId },
      });

      if (!profile) {
        // Return a special response indicating profile needs completion
        return {
          user,
          profileExists: false,
          message: "Please complete your profile",
          requiredFields: ["firstName", "lastName"], // Add other required fields
        };
      }

      // Return the full profile if it exists
      return {
        ...profile,
        user,
        profileExists: true,
      };
    } catch (error) {
      // Enhanced error handling
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        console.error("Prisma error:", error.message);
        throw new Error(
          `Database error: ${error.meta?.message || error.message}`
        );
      }
      console.error("Error in getProfile:", error);
      throw error;
    }
  }

  /**
   * Update profile picture
   * @param {Object} params
   * @param {string} params.userId
   * @param {Buffer} params.imageBuffer
   * @returns {Promise<Object>} Updated profile
   */
  static async updateProfilePicture({ userId, imageBuffer }) {
    const uploadResult = await uploadToCloudinary(imageBuffer, {
      folder: "profile-pictures",
      transformation: { width: 300, height: 300, crop: "fill" },
    });

    return this.partialUpdate(userId, {
      avatarUrl: uploadResult.secure_url,
    });
  }

  /**
   * Update notification preferences
   * @param {Object} params
   * @param {string} params.userId
   * @param {Object} params.preferences
   * @returns {Promise<Object>} Updated profile
   */
  static async updateNotificationPreferences({ userId, preferences }) {
    return this.partialUpdate(userId, {
      notificationPreferences: preferences,
    });
  }

  /**
   * Search profiles by criteria with validation
   * @param {Object} filters
   * @param {number} limit
   * @param {number} offset
   * @returns {Promise<Array>} List of matching profiles
   */
  static async searchProfiles(filters = {}, limit = 20, offset = 0) {
    // Validate filters
    // console.log("Search filters ROle", filters.role);
    const validFilters = {};
    if (filters.name) {
      validFilters.OR = [
        { firstName: { contains: filters.name, mode: "insensitive" } },
        { lastName: { contains: filters.name, mode: "insensitive" } },
      ];
    }
    if (filters.city)
      validFilters.city = { contains: filters.city, mode: "insensitive" };
    if (filters.country) validFilters.country = filters.country;
    if (filters.gender) validFilters.gender = filters.gender;
    if (filters.role) {
      validFilters.user = {
        is: {
          roles: {
            some: {
              role: {
                name: filters.role, // e.g., "owner"
              },
            },
          },
        },
      };
    }

    return prisma.profile.findMany({
      where: validFilters,
      take: Math.min(limit, 100), // Enforce max limit
      skip: offset,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        avatarUrl: true,
        city: true,
        country: true,
        user: {
          select: {
            username: true,
            roles: {
              select: {
                role: {
                  select: {
                    name: true,
                  },
                },
              },
            },
          },
        },
      },
    });
  }

  /**
   * Get profiles by IDs
   * @param {Array<string>} userIds
   * @returns {Promise<Array>} List of profiles
   */
  static async getProfilesByIds(userIds) {
    return prisma.profile.findMany({
      where: { userId: { in: userIds } },
      select: {
        userId: true,
        firstName: true,
        lastName: true,
        avatarUrl: true,
        city: true,
        country: true,
      },
    });
  }

  /**
   * Delete user profile
   * @param {string} userId
   * @returns {Promise<void>}
   */
  static async deleteProfile(userId) {
    await prisma.profile.delete({
      where: { userId },
    });
  }
}
