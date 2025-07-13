// reviews/routes.js
import express from 'express';
import controller from './controller.js';
import {
  createReviewSchema,
  replySchema,
  sanitizeReview
} from './schema.js';
import authMiddleware from '../../middleware/auth.js';
import validate from '../../middleware/validate.js';

const router = express.Router();

router.post('/',
  authMiddleware,
  validate(createReviewSchema),
  controller.createReviewLimiter,
  controller.createReview
);

router.post('/:id/reply',
  authMiddleware,
  validate(replySchema),
  controller.replyToReview
);

router.get('/',
  controller.getReviews
);

router.get('/:propertyId/rating',
  controller.getAverageRating
);

export default router;