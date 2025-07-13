// reviews/controller.js
import * as service from './service.js';
import { validateRequest } from './schema.js';
import rateLimit from 'express-rate-limit';

const reviewLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000, // 24 hours
  max: 3, // 3 reviews per day per IP
  message: 'Too many reviews created, please try again later'
});

export const createReview = async (req, res, next) => {
  try {
    const data = await validateRequest('CREATE_REVIEW', req.body);
    const review = await service.createReview(req.user.id, data);
    res.status(201).json(review);
  } catch (error) {
    next(error);
  }
};

export const replyToReview = async (req, res, next) => {
  try {
    const data = await validateRequest('REPLY_REVIEW', req.body);
    const updated = await service.addReply(req.user.id, req.params.id, data.response);
    res.json(updated);
  } catch (error) {
    next(error);
  }
};

export const getReviews = async (req, res, next) => {
  try {
    const { propertyId, lat, lng, radius } = req.query;
    const locationFilter = lat && lng && radius ? { lat, lng, radius } : null;
    
    const reviews = await service.getPropertyReviews(propertyId, locationFilter);
    res.json(reviews);
  } catch (error) {
    next(error);
  }
};

export const getAverageRating = async (req, res, next) => {
  try {
    const rating = await service.getCachedRating(req.params.propertyId);
    res.json({ rating });
  } catch (error) {
    next(error);
  }
};