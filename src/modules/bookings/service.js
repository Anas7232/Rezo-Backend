import prisma from "../../config/database.js";
import { DateTime, Interval } from "luxon";
import redis from "../../config/redis.js";
import {
  BookingError,
  ConflictError,
  NotFoundError,
  DatabaseError,
  ValidationError,
} from "../../utils/apiError.js";
import logger from "../../config/logger.js";
import pkg from "@prisma/client";
const { BookingStatus, PaymentStatus } = pkg;
import { validate as isValidUUID } from "uuid";
import { connect } from "mongoose";

class BookingService {
  constructor() {
    this.LOCK_TIMEOUT = 5000; // 5 seconds
    this.CANCELLATION_WINDOW = 48; // hours
    this.MAX_BULK_CONCURRENCY = 5;
    this.MIN_BOOKING_DAYS = 1;
    this.MAX_BOOKING_DAYS = 30;
  }

  // Core booking creation with transaction locking
  async createBooking({
    propertyId,
    userId,
    startDate,
    endDate,
    adults = 1,
    children = 0,
    infants = 0,
    paymentMethod,
  }) {
    // Input validation
    if (!isValidUUID(propertyId)) {
      throw new ValidationError(`Invalid property ID format: ${propertyId}`);
    }
    if (!isValidUUID(userId)) {
      throw new ValidationError(`Invalid user ID format: ${userId}`);
    }
    if (!propertyId || !userId || !startDate || !endDate) {
      throw new ValidationError("Missing required booking parameters");
    }

    if (new Date(startDate) >= new Date(endDate)) {
      throw new ValidationError("End date must be after start date");
    }

    const propertyLockKey = `property:${propertyId}:lock`;
    let lockAcquired = false;

    try {
      return await prisma.$transaction(async (tx) => {
        // Acquire distributed lock with retry logic
        lockAcquired = await this.acquireLockWithRetry(propertyLockKey);
        if (!lockAcquired) {
          throw new ConflictError(
            "Property is currently being modified by another request"
          );
        }

        // Validate property exists and can be booked
        const property = await tx.property.findUnique({
          where: { id: propertyId },
          select: {
            id: true,
            maxGuests: true,
            minStay: true,
            maxStay: true,
            status: true,
          },
        });

        if (!property) {
          throw new NotFoundError("Property not found");
        }

        if (property.status !== "APPROVED") {
          throw new BookingError("Property is not available for booking");
        }

        // Validate guest count
        const totalGuests = adults + children;
        if (totalGuests > property.maxGuests) {
          throw new BookingError(
            `Property can only accommodate ${property.maxGuests} guests`
          );
        }

        // Validate stay duration
        const stayDuration = DateTime.fromJSDate(endDate).diff(
          DateTime.fromJSDate(startDate),
          "days"
        ).days;
        if (stayDuration < (property.minStay || this.MIN_BOOKING_DAYS)) {
          throw new BookingError(
            `Minimum stay is ${property.minStay || this.MIN_BOOKING_DAYS} days`
          );
        }

        if (property.maxStay && stayDuration > property.maxStay) {
          throw new BookingError(`Maximum stay is ${property.maxStay} days`);
        }

        // Check availability
        const availability = await this.checkAvailabilityWithLock(
          tx,
          propertyId,
          startDate,
          endDate
        );

        // Calculate pricing
        const { totalPrice, basePrice, taxes, fees } =
          await this.calculateTotalPrice(
            tx,
            propertyId,
            availability,
            startDate,
            endDate,
            totalGuests
          );

        // Create booking with all details
        const booking = await tx.booking.create({
          data: {
            propertyId,
            tenantId: userId,
            startDate,
            endDate,
            totalPrice,
            basePrice,
            taxes,
            fees,
            adults,
            children,
            infants,
            status: BookingStatus.PENDING,
            payment: {
              create: {
                amount: totalPrice,
                currency: "USD",
                status: PaymentStatus.PENDING,
                userId,
                propertyId,
                paymentMethod,
              },
            },
          },
          include: {
            property: {
              select: {
                id: true,
                title: true,
                address: true,
              },
            },
            payment: true,
          },
        });

        // Update availability
        await this.updateAvailabilitySlots(
          tx,
          propertyId,
          booking.id,
          startDate,
          endDate
        );

        logger.info(
          `Booking ${booking.id} created for property ${propertyId} by user ${userId}`
        );
        return booking;
      });
    } catch (error) {
      logger.error(`Booking creation failed: ${error.message}`, {
        propertyId,
        userId,
        error: error.stack,
      });
      throw error;
    } finally {
      if (lockAcquired) {
        await redis.del(propertyLockKey).catch((err) => {
          logger.error(
            `Failed to release lock ${propertyLockKey}: ${err.message}`
          );
        });
      }
    }
  }

  // Helper to acquire lock with retry
  async acquireLockWithRetry(key, retries = 3, delay = 100) {
    for (let i = 0; i < retries; i++) {
      const lock = await redis.set(
        key,
        "locked",
        "PX",
        this.LOCK_TIMEOUT,
        "NX"
      );
      if (lock) return true;
      if (i < retries - 1)
        await new Promise((resolve) => setTimeout(resolve, delay));
    }
    return false;
  }

  // Atomic cancellation with fee calculation
  async cancelBooking(bookingId, userId, reason = null) {
    try {
      return await prisma.$transaction(async (tx) => {
        const booking = await tx.booking.findUnique({
          where: { id: bookingId },
          include: {
            payment: true,
            property: {
              select: {
                cancellationPolicy: true,
              },
            },
          },
        });

        if (!booking) throw new NotFoundError("Booking not found");
        if (booking.tenantId !== userId)
          throw new BookingError("Unauthorized to cancel this booking");

        this.validateStateTransition(booking.status, BookingStatus.CANCELLED);

        const cancellationFee = this.calculateCancellationFee(booking);
        const refundAmount = Number(booking.totalPrice) - cancellationFee;

        const [updatedBooking] = await Promise.all([
          tx.booking.update({
            where: { id: bookingId },
            data: {
              status: BookingStatus.CANCELLED,
              cancellationReason: reason,
              cancellationDate: new Date(),
              payment: {
                update: {
                  status:
                    cancellationFee > 0
                      ? PaymentStatus.PARTIALLY_REFUNDED
                      : PaymentStatus.REFUNDED,
                  refundAmount,
                  refundedAt: new Date(),
                },
              },
            },
          }),
          this.releaseAvailabilitySlots(
            tx,
            booking.propertyId,
            booking.startDate,
            booking.endDate
          ),
        ]);

        logger.info(
          `Booking ${bookingId} cancelled by user ${userId} with refund ${refundAmount}`
        );

        return updatedBooking;
      });
    } catch (error) {
      logger.error(`Booking cancellation failed: ${error.message}`, {
        bookingId,
        userId,
        error: error.stack,
      });
      throw error;
    }
  }

  // Enhanced availability checking
  async checkAvailabilityWithLock(tx, propertyId, start, end) {
    try {
      const availability = await tx.availability.findMany({
        where: {
          propertyId,
          startDate: { lte: end },
          endDate: { gte: start },
          isAvailable: true,
          bookingId: null, // Only slots not already booked
        },
        orderBy: {
          startDate: "asc",
        },
      });

      if (availability.length === 0) {
        throw new ConflictError("No availability for selected dates");
      }

      const bookingInterval = Interval.fromDateTimes(
        DateTime.fromJSDate(start),
        DateTime.fromJSDate(end)
      );

      // Check for continuous availability
      let currentDate = DateTime.fromJSDate(start);
      while (currentDate < DateTime.fromJSDate(end)) {
        const isAvailable = availability.some(
          (slot) =>
            currentDate >= DateTime.fromJSDate(slot.startDate) &&
            currentDate < DateTime.fromJSDate(slot.endDate)
        );

        if (!isAvailable) {
          throw new ConflictError(
            `Date ${currentDate.toISODate()} is not available`
          );
        }

        currentDate = currentDate.plus({ days: 1 });
      }

      return availability;
    } catch (error) {
      logger.error(`Availability check failed for property ${propertyId}`, {
        start,
        end,
        error: error.stack,
      });
      throw error;
    }
  }

  // Update availability slots with booking reference
  async updateAvailabilitySlots(tx, propertyId, bookingId, start, end) {
    try {
      await tx.availability.updateMany({
        where: {
          propertyId,
          startDate: { lt: end },
          endDate: { gt: start },
          isAvailable: true,
          bookingId: null,
        },
        data: {
          isAvailable: false,
          bookingId,
        },
      });

      logger.debug(
        `Updated availability for property ${propertyId} from ${start} to ${end}`
      );
    } catch (error) {
      logger.error(`Failed to update availability slots`, {
        propertyId,
        start,
        end,
        error: error.stack,
      });
      throw new DatabaseError("Failed to update availability");
    }
  }

  // Release availability slots on cancellation
  async releaseAvailabilitySlots(tx, propertyId, start, end) {
    try {
      await tx.availability.updateMany({
        where: {
          propertyId,
          startDate: { gte: start },
          endDate: { lte: end },
          isAvailable: false,
        },
        data: {
          isAvailable: true,
          bookingId: null,
        },
      });

      logger.debug(
        `Released availability for property ${propertyId} from ${start} to ${end}`
      );
    } catch (error) {
      logger.error(`Failed to release availability slots`, {
        propertyId,
        start,
        end,
        error: error.stack,
      });
      throw new DatabaseError("Failed to release availability");
    }
  }

  // Comprehensive price calculation
  async calculateTotalPrice(
    tx,
    propertyId,
    availability,
    startDate,
    endDate,
    guestCount
  ) {
    try {
      const property = await tx.property.findUnique({
        where: { id: propertyId },
        select: {
          basePrice: true,
          currency: true,
        },
      });

      if (!property) {
        throw new NotFoundError("Property not found for price calculation");
      }

      const start = DateTime.fromJSDate(startDate);
      const end = DateTime.fromJSDate(endDate);
      let basePrice = 0;
      const dailyPrices = [];

      // Calculate base price from availability slots
      for (let day = start; day < end; day = day.plus({ days: 1 })) {
        const slot = availability.find(
          (s) =>
            day >= DateTime.fromJSDate(s.startDate) &&
            day < DateTime.fromJSDate(s.endDate)
        );

        if (!slot) {
          throw new BookingError(`No availability for ${day.toISODate()}`);
        }

        const dailyRate = Number(slot.price || property.basePrice);
        basePrice += dailyRate;
        dailyPrices.push(dailyRate);
      }

      // Calculate taxes and fees (simplified example)
      const taxes = basePrice * 0.1; // 10% tax
      const fees = guestCount > 2 ? 20 : 0; // Extra guest fee

      const totalPrice = basePrice + taxes + fees;

      return {
        totalPrice,
        basePrice,
        taxes,
        fees,
        currency: property.currency,
        dailyPrices,
      };
    } catch (error) {
      logger.error(`Price calculation failed for property ${propertyId}`, {
        startDate,
        endDate,
        error: error.stack,
      });
      throw new BookingError("Failed to calculate booking price");
    }
  }

  // Enhanced cancellation fee calculation
  calculateCancellationFee(booking) {
    try {
      const policy = booking.property.cancellationPolicy || {};
      const hoursUntilCheckin = DateTime.fromJSDate(booking.startDate).diffNow(
        "hours"
      ).hours;

      if (hoursUntilCheckin < 0) {
        return booking.totalPrice; // No refund after check-in time
      }

      if (hoursUntilCheckin < (policy.strictWindow || 24)) {
        return booking.totalPrice * (policy.strictFee || 1); // 100% fee
      }

      if (
        hoursUntilCheckin <
        (policy.cancellationWindowHours || this.CANCELLATION_WINDOW)
      ) {
        return booking.totalPrice * (policy.feePercentage || 0.5); // 50% fee
      }

      return booking.totalPrice * (policy.flexibleFee || 0); // 0% fee
    } catch (error) {
      logger.error(
        `Cancellation fee calculation failed for booking ${booking.id}`,
        {
          error: error.stack,
        }
      );
      return booking.totalPrice * 0.5; // Fallback to 50% fee
    }
  }

  // Bulk booking processing with enhanced error handling
  async processBulkBookings(requests, userId) {
    const { default: PQueue } = await import("p-queue");
    const queue = new PQueue({
      concurrency: this.MAX_BULK_CONCURRENCY,
      timeout: 30000, // 30 seconds per job
    });

    const results = await Promise.allSettled(
      requests.map((req) =>
        queue.add(() =>
          this.createBooking({ ...req, userId })
            .then((value) => ({
              success: true,
              data: value,
              request: req,
            }))
            .catch((error) => ({
              success: false,
              error: {
                message: error.message,
                code: error.code,
                stack:
                  process.env.NODE_ENV === "development"
                    ? error.stack
                    : undefined,
              },
              request: req,
            }))
        )
      )
    );

    // Process results
    return results.map((result) => {
      if (result.status === "fulfilled") {
        return result.value;
      }
      return {
        success: false,
        error: {
          message: "Queue processing failed",
          details: result.reason,
        },
      };
    });
  }

  // State transition validation with all booking statuses
  validateStateTransition(currentStatus, newStatus) {
    const validTransitions = {
      [BookingStatus.PENDING]: [
        BookingStatus.CONFIRMED,
        BookingStatus.CANCELLED,
      ],
      [BookingStatus.CONFIRMED]: [BookingStatus.PAID, BookingStatus.CANCELLED],
      [BookingStatus.PAID]: [BookingStatus.ACTIVE, BookingStatus.CANCELLED],
      [BookingStatus.ACTIVE]: [BookingStatus.COMPLETED],
      [BookingStatus.COMPLETED]: [],
      [BookingStatus.CANCELLED]: [BookingStatus.REFUND_PENDING],
      [BookingStatus.REFUND_PENDING]: [BookingStatus.REFUNDED],
      [BookingStatus.REFUNDED]: [],
    };

    if (!validTransitions[currentStatus]) {
      throw new BookingError(`Invalid current status: ${currentStatus}`);
    }

    if (!validTransitions[currentStatus].includes(newStatus)) {
      throw new BookingError(
        `Invalid status transition: ${currentStatus} → ${newStatus}. ` +
          `Allowed transitions: ${validTransitions[currentStatus].join(", ")}`
      );
    }
  }

  /**
   * Check property availability
   * @param {string} propertyId
   * @param {Date} startDate
   * @param {Date} endDate
   * @returns {Promise<object>} Availability data
   */
  async checkAvailability(propertyId, startDate, endDate) {
    try {
      // Convert to Luxon DateTime for proper comparison
      const start = DateTime.fromJSDate(startDate);
      const end = DateTime.fromJSDate(endDate);

      // Check if property exists
      const property = await prisma.property.findUnique({
        where: { id: propertyId },
        select: { id: true, minStay: true, maxStay: true },
      });

      if (!property) {
        throw new NotFoundError("Property not found");
      }

      // Get availability slots
      const availability = await prisma.availability.findMany({
        where: {
          propertyId,
          startDate: { lte: endDate },
          endDate: { gte: startDate },
          isAvailable: true,
        },
        orderBy: { startDate: "asc" },
      });

      // Check continuous availability
      let currentDate = start;
      const availableDates = [];
      let totalPrice = 0;

      while (currentDate <= end) {
        const slot = availability.find(
          (s) =>
            currentDate >= DateTime.fromJSDate(s.startDate) &&
            currentDate < DateTime.fromJSDate(s.endDate)
        );

        if (!slot) {
          return {
            available: false,
            firstConflict: currentDate.toISODate(),
            propertyId,
            minStay: property.minStay,
            maxStay: property.maxStay,
          };
        }

        availableDates.push({
          date: currentDate.toISODate(),
          price: Number(slot.price),
        });
        totalPrice += Number(slot.price);
        currentDate = currentDate.plus({ days: 1 });
      }

      return {
        available: true,
        propertyId,
        availableDates,
        totalPrice,
        currency: "USD", // Or get from property
        minStay: property.minStay,
        maxStay: property.maxStay,
      };
    } catch (error) {
      logger.error("Availability check failed", {
        propertyId,
        startDate,
        endDate,
        error: error.message,
      });
      throw error;
    }
  }
  async getUserBookings({ userId, status, page = 1, limit = 10 }) {
    try {
      // Build the where clause dynamically
      const where = {
        tenantId: userId,
      };

      // Only add status if it's provided
      if (status) {
        where.status = status;
      }

      const bookings = await prisma.booking.findMany({
        where,
        include: {
          property: true,
          payment: true,
        },
        skip: (page - 1) * limit,
        take: limit,
        orderBy: {
          createdAt: "desc", // Add sensible default ordering
        },
      });

      const total = await prisma.booking.count({ where });

      return { bookings, total };
    } catch (error) {
      logger.error("Failed to fetch user bookings", {
        userId,
        error: error.message,
      });
      throw error;
    }
  }

  async getBookingDetails(bookingId) {
    try {
      const booking = await prisma.booking.findUnique({
        where: { id: bookingId },
        include: {
          property: true,
          payment: true,
        },
      });

      if (!booking) {
        throw new NotFoundError("Booking not found");
      }

      return booking;
    } catch (error) {
      logger.error("Failed to fetch booking details", {
        bookingId,
        error: error.message,
      });
      throw error;
    }
  }

  async updateBooking(bookingId, userId, updates) {
    return await prisma.$transaction(async (tx) => {
      try {
        // 1. First find the booking with necessary relations
        const booking = await tx.booking.findUnique({
          where: { id: bookingId },
          include: {
            property: {
              select: {
                id: true,
                minStay: true,
                maxStay: true,
                availability: {
                  where: {
                    isAvailable: false,
                    bookingId: bookingId,
                  },
                },
              },
            },
          },
        });

        if (!booking) {
          throw new NotFoundError("Booking not found");
        }

        if (booking.tenantId !== userId) {
          throw new BookingError("Unauthorized to update this booking");
        }

        // 2. Remove propertyId from updates if present
        const { propertyId, ...validUpdates } = updates;

        if (propertyId && propertyId !== booking.property.id) {
          throw new ValidationError(
            "Cannot change booking property after creation"
          );
        }

        // 3. Validate dates if they're being updated
        if (validUpdates.startDate || validUpdates.endDate) {
          const startDate = validUpdates.startDate
            ? new Date(validUpdates.startDate)
            : new Date(booking.startDate);
          const endDate = validUpdates.endDate
            ? new Date(validUpdates.endDate)
            : new Date(booking.endDate);

          // Check date validity
          if (startDate >= endDate) {
            throw new ValidationError("End date must be after start date");
          }

          // Check against property stay requirements
          const duration = (endDate - startDate) / (1000 * 60 * 60 * 24);
          if (booking.property.minStay && duration < booking.property.minStay) {
            throw new ValidationError(
              `Minimum stay is ${booking.property.minStay} days`
            );
          }
          if (booking.property.maxStay && duration > booking.property.maxStay) {
            throw new ValidationError(
              `Maximum stay is ${booking.property.maxStay} days`
            );
          }

          // Check availability for new dates if dates are changing
          const conflictingBookings = await tx.booking.findMany({
            where: {
              propertyId: booking.property.id,
              id: { not: bookingId },
              OR: [
                { startDate: { lt: endDate }, endDate: { gt: startDate } },
                { startDate: { gte: startDate, lte: endDate } },
              ],
            },
          });

          if (conflictingBookings.length > 0) {
            throw new ConflictError("Selected dates are not available");
          }
        }

        // 4. Prepare update data
        const updatedData = {
          ...validUpdates,
          ...(validUpdates.startDate && {
            startDate: new Date(validUpdates.startDate),
          }),
          ...(validUpdates.endDate && {
            endDate: new Date(validUpdates.endDate),
          }),
          updatedAt: new Date(),
        };

        // 5. Perform the update
        const updatedBooking = await tx.booking.update({
          where: { id: bookingId },
          data: updatedData,
          include: {
            property: {
              select: {
                title: true,
                address: true,
              },
            },
            payment: true,
          },
        });

        // 6. Update availability slots if dates changed
        if (validUpdates.startDate || validUpdates.endDate) {
          // Release old availability slots
          await tx.availability.updateMany({
            where: {
              propertyId: booking.property.id,
              bookingId: bookingId,
            },
            data: {
              isAvailable: true,
              bookingId: null,
            },
          });

          // Reserve new availability slots
          const newStartDate = updatedBooking.startDate;
          const newEndDate = updatedBooking.endDate;

          await tx.availability.updateMany({
            where: {
              propertyId: booking.property.id,
              startDate: { lt: newEndDate },
              endDate: { gt: newStartDate },
              isAvailable: true,
            },
            data: {
              isAvailable: false,
              bookingId: bookingId,
            },
          });
        }

        return updatedBooking;
      } catch (error) {
        logger.error("Failed to update booking", {
          bookingId,
          userId,
          updates,
          error: error.message,
          stack: error.stack,
        });
        throw error;
      }
    });
  }
  async generateInvoice(bookingId) {
    try {
      const booking = await prisma.booking.findUnique({
        where: { id: bookingId },
        include: {
          property: {
            select: {
              title: true,
              address: true,
              basePrice: true,
            },
          },
          payment: true,
          tenant: {
            select: {
              id: true,
              username: true,
              email: true,
              profile: {
                select: {
                  firstName: true,
                  lastName: true,
                  phone: true, // Changed from phoneNumber to phone
                  currentAddress: true,
                },
              },
            },
          },
        },
      });

      if (!booking) {
        throw new NotFoundError("Booking not found");
      }

      const tenantName = booking.tenant?.profile
        ? `${booking.tenant.profile.firstName} ${booking.tenant.profile.lastName}`
        : booking.tenant?.username;

      // Get contact details from profile if available
      const tenantContact = booking.tenant?.profile
        ? {
            phone: booking.tenant.profile.phone, // Changed from phoneNumber to phone
            address: booking.tenant.profile.currentAddress,
          }
        : null;

      // Calculate any additional fields
      const subtotal = booking.property.basePrice;
      const taxRate = 0.1; // Example 10% tax
      const taxAmount = subtotal * taxRate;
      const totalAmount = subtotal + taxAmount;

      // Generate invoice data
      const invoiceNumber = `INV-${bookingId.slice(
        0,
        8
      )}-${DateTime.now().toFormat("yyyyMMdd")}`;

      const invoice = {
        invoiceNumber,
        date: DateTime.now().toISO(),
        dueDate: DateTime.now().plus({ days: 7 }).toISO(),

        // Booking details
        booking: {
          id: booking.id,
          startDate: booking.startDate,
          endDate: booking.endDate,
          adults: booking.adults,
          children: booking.children,
          BookingStatus: booking.status,
        },

        // Property details
        property: {
          title: booking.property.title,
          address: booking.property.address,
          basePrice: booking.property.basePrice,
        },

        // Payment details
        payment: {
          amount: booking.payment.amount,
          status: booking.payment.status,
          method: booking.payment.method,
          transactionId: booking.payment.transactionId,
        },

        // User details
        user: booking.tenant
          ? {
              name: tenantName,
              email: booking.tenant.email,
              ...tenantContact,
            }
          : null,

        // Calculated amounts
        amounts: {
          subtotal,
          taxRate: `${taxRate * 100}%`,
          taxAmount,
          totalAmount,
          amountPaid: booking.payment.amount,
          balanceDue: totalAmount - booking.payment.amount,
        },

        // Additional metadata
        notes: "Thank you for your booking!",
        terms: "Payment due within 7 days",
      };

      return {
        success: true,
        data: invoice,
        message: "Invoice generated successfully",
      };
    } catch (error) {
      logger.error("Failed to generate invoice", {
        bookingId,
        error: error.message,
      });
      throw error;
    }
  }
}

export default new BookingService();
