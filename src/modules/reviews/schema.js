// reviews/schema.js
import Joi from 'joi';
import { ReviewStatus } from '@prisma/client';
import sanitizeHtml from 'sanitize-html';

export const createReviewSchema = Joi.object({
  bookingId: Joi.string().uuid().required(),
  rating: Joi.number().integer().min(1).max(5).required(),
  comment: Joi.string().max(500).optional()
});

export const replySchema = Joi.object({
  response: Joi.string().max(500).required()
});

const sanitizeOptions = {
  allowedTags: [],
  allowedAttributes: {}
};

export const sanitizeReview = (text) => {
  const masked = text.replace(/(\b\d{10}\b|\S+@\S+\.\S+)/g, '***');
  return sanitizeHtml(masked, sanitizeOptions);
};