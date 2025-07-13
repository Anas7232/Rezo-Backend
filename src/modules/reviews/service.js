// reviews/service.js
import prisma from "../../config/database.js";
import redis from "../../config/redis.js";
import mongoClient from "../../config/mongodb.js";
import { ForbiddenError, NotFoundError } from "../../utils/apiError.js";
import { sanitizeReview } from "./schema.js";
import logger from "../../config/logger.js";

const REVIEW_CACHE_TTL = 3600; // 1 hour
const RATING_CACHE_TTL = 86400; // 24 hours
const TOP_REVIEWS_COUNT = 5;

export const createReview = async (userId, { bookingId, rating, comment }) => {
  return await prisma.$transaction(async (tx) => {
    const booking = await tx.booking.findUnique({
      where: { id: bookingId },
      include: { property: true },
    });

    if (
      !booking ||
      booking.tenantId !== userId ||
      booking.status !== "COMPLETED"
    ) {
      throw new ForbiddenError("Invalid booking for review");
    }

    const existingReview = await tx.review.findUnique({
      where: { bookingId },
    });

    if (existingReview) {
      throw new ForbiddenError("Review already exists for this booking");
    }

    const sanitizedComment = comment ? sanitizeReview(comment) : null;

    const review = await tx.review.create({
      data: {
        propertyId: booking.propertyId,
        bookingId,
        tenantId: userId,
        rating,
        comment: sanitizedComment,
      },
    });

    await updateRatingCache(booking.propertyId);
    await updateTopReviewsCache(booking.propertyId);

    return review;
  });
};

const updateRatingCache = async (propertyId) => {
  const reviews = await prisma.review.findMany({
    where: { propertyId },
    select: { rating: true, createdAt: true },
  });

  const weightedSum = reviews.reduce((acc, review) => {
    const ageDays = (Date.now() - review.createdAt) / (1000 * 86400);
    const weight = Math.exp(-ageDays / 30); // Exponential decay weighting
    return acc + review.rating * weight;
  }, 0);

  const totalWeight = reviews.reduce((acc, review) => {
    const ageDays = (Date.now() - review.createdAt) / (1000 * 86400);
    return acc + Math.exp(-ageDays / 30);
  }, 0);

  const average = totalWeight > 0 ? (weightedSum / totalWeight).toFixed(2) : 0;

  await redis.setex(`property:${propertyId}:rating`, RATING_CACHE_TTL, average);
};

const updateTopReviewsCache = async (propertyId) => {
  const topReviews = await prisma.review.findMany({
    where: { propertyId },
    orderBy: [{ rating: "desc" }, { createdAt: "desc" }],
    take: TOP_REVIEWS_COUNT,
  });

  await redis.setex(
    `property:${propertyId}:top-reviews`,
    REVIEW_CACHE_TTL,
    JSON.stringify(topReviews)
  );
};

export const addReply = async (propertyOwnerId, reviewId, response) => {
  return await prisma.$transaction(async (tx) => {
    const review = await tx.review.findUnique({
      where: { id: reviewId },
      include: { property: true },
    });

    if (review.property.ownerId !== propertyOwnerId) {
      throw new ForbiddenError("Not authorized to reply to this review");
    }

    return tx.review.update({
      where: { id: reviewId },
      data: { response: sanitizeReview(response) },
    });
  });
};

export const getPropertyReviews = async (propertyId, locationFilter) => {
  const cacheKey = `property:${propertyId}:reviews`;
  const cached = await redis.get(cacheKey);

  if (cached) return JSON.parse(cached);

  let propertyIds = [propertyId];
  if (locationFilter) {
    const { lat, lng, radius } = locationFilter;
    const properties = await mongoClient
      .db()
      .collection("properties")
      .find({
        location: {
          $near: {
            $geometry: { type: "Point", coordinates: [lng, lat] },
            $maxDistance: radius,
          },
        },
      })
      .project({ _id: 1 })
      .toArray();

    propertyIds = properties.map((p) => p._id);
  }

  const reviews = await prisma.review.findMany({
    where: { propertyId: { in: propertyIds } },
    include: { tenant: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" },
  });

  await redis.setex(cacheKey, REVIEW_CACHE_TTL, JSON.stringify(reviews));
  return reviews;
};

export const getCachedRating = async (propertyId) => {
  const cachedRating = await redis.get(`property:${propertyId}:rating`);
  if (cachedRating) return parseFloat(cachedRating);

  const reviews = await prisma.review.findMany({
    where: { propertyId },
    select: { rating: true, createdAt: true },
  });

  await updateRatingCache(propertyId);
  return parseFloat(await redis.get(`property:${propertyId}:rating`));
};
