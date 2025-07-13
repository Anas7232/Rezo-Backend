import BookingService from "./service.js";
import { NotFoundError, ValidationError } from "../../utils/apiError.js";
import logger from "../../config/logger.js";
import { validateBookingDates, validateGuests } from "./validators.js";

class BookingController {
  /**
   * @desc    Create a new booking
   * @route   POST /api/bookings
   * @access  Private
   */
  async createBooking(req, res, next) {
    const {
      propertyId,
      startDate,
      endDate,
      adults,
      children,
      infants,
      paymentMethod,
    } = req.body;
    const userId = req.user.id;

    try {
      // Validate input
      validateBookingDates(startDate, endDate);
      validateGuests(adults, children, infants);

      const booking = await BookingService.createBooking({
        propertyId,
        userId,
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        adults: parseInt(adults),
        children: parseInt(children),
        infants: parseInt(infants),
        paymentMethod,
      });

      logger.info(`Booking created successfully for user ${userId}`);
      res.status(201).json({
        success: true,
        data: booking,
        message: "Booking created successfully",
      });
    } catch (error) {
      logger.error(`Booking creation failed: ${error.message}`, {
        userId,
        propertyId,
        error: error.stack,
      });
      next(error);
    }
  }

  /**
   * @desc    Cancel a booking
   * @route   PATCH /api/bookings/:id/cancel
   * @access  Private
   */
  async cancelBooking(req, res, next) {
    const { id } = req.params;
    const { reason } = req.body;
    const userId = req.user.id;

    try {
      if (!id) throw new ValidationError("Booking ID is required");

      const cancelledBooking = await BookingService.cancelBooking(
        id,
        userId,
        reason
      );

      res.status(200).json({
        success: true,
        data: cancelledBooking,
        message: "Booking cancelled successfully",
      });
    } catch (error) {
      logger.error(`Booking cancellation failed: ${error.message}`, {
        bookingId: id,
        userId,
        error: error.stack,
      });
      next(error);
    }
  }

  /**
   * @desc    Get booking details
   * @route   GET /api/bookings/:id
   * @access  Private
   */
  async getBooking(req, res, next) {
    const { id } = req.params;
    const userId = req.user.id;

    try {
      if (!id) throw new ValidationError("Booking ID is required");

      const booking = await BookingService.getBookingDetails(id, userId);

      if (!booking) throw new NotFoundError("Booking not found");

      res.status(200).json({
        success: true,
        data: booking,
      });
    } catch (error) {
      logger.error(`Failed to fetch booking: ${error.message}`, {
        bookingId: id,
        userId,
        error: error.stack,
      });
      next(error);
    }
  }

  /**
   * @desc    Get all bookings for a user
   * @route   GET /api/bookings
   * @access  Private
   */
  async getUserBookings(req, res, next) {
    const userId = req.user.id;
    const { status, page = 1, limit = 10 } = req.query;

    try {
      // Convert page and limit to numbers
      const pageNum = parseInt(page, 10);
      const limitNum = parseInt(limit, 10);

      // Validate inputs
      if (isNaN(pageNum)) throw new ValidationError("Page must be a number");
      if (isNaN(limitNum)) throw new ValidationError("Limit must be a number");
      if (limitNum > 100) throw new ValidationError("Maximum limit is 100");

      const { bookings, total } = await BookingService.getUserBookings({
        userId,
        status,
        page: pageNum,
        limit: limitNum,
      });

      res.status(200).json({
        success: true,
        count: bookings.length,
        total,
        pages: Math.ceil(total / limitNum),
        currentPage: pageNum,
        data: bookings,
      });
    } catch (error) {
      logger.error(`Failed to fetch user bookings: ${error.message}`, {
        userId,
        error: error.stack,
      });
      next(error);
    }
  }

  /**
   * @desc    Check property availability
   * @route   GET /api/properties/:id/availability
   * @access  Public
   */
  async checkAvailability(req, res, next) {
    const { id } = req.params;
    const { startDate, endDate } = req.query;

    try {
      if (!id || !startDate || !endDate) {
        throw new ValidationError("Property ID and date range are required");
      }

      const availability = await BookingService.checkAvailability(
        id,
        new Date(startDate),
        new Date(endDate)
      );

      res.status(200).json({
        success: true,
        data: availability,
      });
    } catch (error) {
      logger.error(`Availability check failed: ${error.message}`, {
        propertyId: id,
        startDate,
        endDate,
        error: error.stack,
      });
      next(error);
    }
  }

  /**
   * @desc    Process multiple bookings (bulk)
   * @route   POST /api/bookings/bulk
   * @access  Private
   */
  async createBulkBookings(req, res, next) {
    const { bookings } = req.body;
    const userId = req.user.id;

    try {
      if (!bookings || !Array.isArray(bookings)) {
        throw new ValidationError("Bookings array is required");
      }

      const results = await BookingService.processBulkBookings(
        bookings,
        userId
      );

      // Analyze results
      const successful = results.filter((r) => r.success);
      const failed = results.filter((r) => !r.success);

      res.status(207).json({
        // Multi-status code
        success: true,
        total: results.length,
        successful: successful.length,
        failed: failed.length,
        results,
      });
    } catch (error) {
      logger.error(`Bulk booking processing failed: ${error.message}`, {
        userId,
        error: error.stack,
      });
      next(error);
    }
  }

  /**
   * @desc    Update booking details
   * @route   PUT /api/bookings/:id
   * @access  Private
   */
  async updateBooking(req, res, next) {
    const { id } = req.params;
    const updates = req.body;
    const userId = req.user.id;

    try {
      if (!id) throw new ValidationError("Booking ID is required");

      const updatedBooking = await BookingService.updateBooking(
        id,
        userId,
        updates
      );

      res.status(200).json({
        success: true,
        data: updatedBooking,
        message: "Booking updated successfully",
      });
    } catch (error) {
      logger.error(`Booking update failed: ${error.message}`, {
        bookingId: id,
        userId,
        error: error.stack,
      });
      next(error);
    }
  }

  /**
   * @desc    Get booking invoice
   * @route   GET /api/bookings/:id/invoice
   * @access  Private
   */
  async getInvoice(req, res, next) {
    const { id } = req.params;
    const userId = req.user.id;

    try {
      if (!id) throw new ValidationError("Booking ID is required");

      const invoice = await BookingService.generateInvoice(id, userId);

      res.status(200).json({
        success: true,
        data: invoice,
      });
    } catch (error) {
      logger.error(`Invoice generation failed: ${error.message}`, {
        bookingId: id,
        userId,
        error: error.stack,
      });
      next(error);
    }
  }
}

// Export initialized controller instance
export default new BookingController();
