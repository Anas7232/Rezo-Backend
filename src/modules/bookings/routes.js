import express from "express";
import BookingController from "./controller.js";
import { authenticateUser } from "../../middlewares/authentication.js";
import rateLimit from "express-rate-limit";
import Joi from "joi";
import { bookingSchemas, validate } from "./schema.js";

const router = express.Router();

// Configure rate limiters
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300, // General API limit
  standardHeaders: true,
  legacyHeaders: false,
});

const bookingCreationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // Allow 20 booking creations per window
  message: "Too many booking creation attempts, please try again later",
});

const bulkOperationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // Allow 3 bulk operations per hour
  message: "Too many bulk booking operations, please try again later",
});
// router.post("/", bookingCreationLimiter, BookingController.createBooking); // Create new booking
// Apply global middleware
router.use(authenticateUser()); // Authentication for all booking routes
router.use(generalLimiter); // Apply general rate limiting to all routes

// RESTful Booking Routes
router.get(
  "/",
  authenticateUser(),
  // validate({
  //   query: Joi.object({
  //     status: Joi.string()
  //       .valid("PENDING", "CONFIRMED", "CANCELLED", "COMPLETED")
  //       .optional(),
  //     page: Joi.number().integer().min(1).default(1),
  //     limit: Joi.number().integer().min(1).max(100).default(10),
  //   }),
  // }),
  BookingController.getUserBookings
);

router.post(
  "/",
  bookingCreationLimiter,
  validate(bookingSchemas.createBooking),
  BookingController.createBooking
); // Create new booking

// router
//   .route("/bulk")
//   .post(bulkOperationLimiter, BookingController.createBulkBookings); // Bulk operations

router
  .route("/:id")
  .get(BookingController.getBooking) // Get booking details
  .put(
    bookingCreationLimiter,
    // validate({ body: bookingSchemas.updateBooking }),
    BookingController.updateBooking
  ); // Update booking

router
  .route("/:id/cancel")
  .patch(bookingCreationLimiter, BookingController.cancelBooking); // Cancel booking

router.route("/:id/invoice").get(BookingController.getInvoice); // Get booking invoice

// Availability Check (public endpoint)
router.get(
  "/properties/:id/availability",
  rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 30, // 30 requests per minute
    message: "Too many availability checks, please slow down",
  }),
  BookingController.checkAvailability
);

export default router;
