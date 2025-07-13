// bookings/policy.js
import { casbinRBAC, initializeCasbin } from '../../config/casbin.js';
import prisma from '../../config/database.js';
import { ForbiddenError, NotFoundError } from '../../utils/apiError.js';
import logger from '../../config/logger.js';

// Initialize Casbin enforcer
let enforcer;
(async () => {
  try {
    enforcer = await initializeCasbin();
  } catch (error) {
    logger.error('Failed to initialize Casbin:', error);
    process.exit(1);
  }
})();

// Policy decision functions
export const canCreateBooking = async (req, res, next) => {
  try {
    // Basic validation
    if (!req.body?.propertyId) {
      throw new NotFoundError('Property ID is required');
    }

    // Check user status
    if (req.user.bookingBannedUntil && new Date(req.user.bookingBannedUntil) > new Date()) {
      throw new ForbiddenError('Booking privileges temporarily suspended');
    }

    // Check property status
    const property = await prisma.property.findUnique({
      where: { id: req.body.propertyId },
      select: { 
        status: true, 
        ownerId: true,
        minStayDays: true
      }
    });

    if (!property) {
      throw new NotFoundError('Property not found');
    }

    if (property.status !== 'APPROVED') {
      throw new ForbiddenError('Property not available for booking');
    }

    // Prevent self-booking
    if (property.ownerId === req.user.id) {
      throw new ForbiddenError('Cannot book your own property');
    }

    // Check minimum stay requirement
    if (property.minStayDays) {
      const start = new Date(req.body.startDate);
      const end = new Date(req.body.endDate);
      const stayDays = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
      
      if (stayDays < property.minStayDays) {
        throw new ForbiddenError(`Minimum stay requirement not met (${property.minStayDays} days)`);
      }
    }

    // Casbin RBAC check with domain-specific permissions
    const hasPermission = await casbinRBAC.hasAccess(
      req.user.id, 
      `properties/${req.body.propertyId}`, 
      'book'
    );

    if (!hasPermission) {
      throw new ForbiddenError('Booking not allowed for this property');
    }

    next();
  } catch (error) {
    logger.error(`Booking creation policy check failed: ${error.message}`, {
      userId: req.user?.id,
      propertyId: req.body?.propertyId
    });
    next(error);
  }
};

export const canModifyBooking = async (req, res, next) => {
  try {
    const booking = await prisma.booking.findUnique({
      where: { id: req.params.id },
      select: {
        tenantId: true,
        property: { 
          select: { 
            ownerId: true,
            cancellationPolicy: true
          } 
        },
        status: true,
        startDate: true
      }
    });

    if (!booking) {
      throw new NotFoundError('Booking not found');
    }

    // Check Casbin permissions first
    const hasPermission = await casbinRBAC.hasAccess(
      req.user.id,
      `bookings/${req.params.id}`,
      req.method.toLowerCase() // 'put', 'delete', etc.
    );

    if (!hasPermission) {
      throw new ForbiddenError('Not authorized to modify this booking');
    }

    // Additional business logic checks
    const isTenant = booking.tenantId === req.user.id;
    const isOwner = booking.property.ownerId === req.user.id;
    const isAdmin = req.user.roles.includes('ADMIN');

    // Status-based restrictions
    if (req.method === 'PUT' && req.path.includes('cancel')) {
      if (!['PENDING', 'CONFIRMED'].includes(booking.status)) {
        throw new ForbiddenError('Booking cannot be cancelled in its current state');
      }

      // Check cancellation window
      if (booking.property.cancellationPolicy) {
        const hoursUntilCheckin = Math.floor(
          (new Date(booking.startDate) - new Date()) / (1000 * 60 * 60)
        );
        
        if (hoursUntilCheckin < booking.property.cancellationPolicy.windowHours) {
          if (!isAdmin) {
            throw new ForbiddenError('Cancellation window has passed');
          }
        }
      }
    }

    next();
  } catch (error) {
    logger.error(`Booking modification policy check failed: ${error.message}`, {
      bookingId: req.params.id,
      userId: req.user?.id
    });
    next(error);
  }
};

export const canViewBooking = async (req, res, next) => {
  try {
    const booking = await prisma.booking.findUnique({
      where: { id: req.params.id },
      select: {
        tenantId: true,
        property: { select: { ownerId: true } }
      }
    });

    if (!booking) {
      throw new NotFoundError('Booking not found');
    }

    // Check Casbin permissions
    const hasPermission = await casbinRBAC.hasAccess(
      req.user.id,
      `bookings/${req.params.id}`,
      'read'
    );

    if (!hasPermission) {
      throw new ForbiddenError('Not authorized to view this booking');
    }

    next();
  } catch (error) {
    logger.error(`Booking view policy check failed: ${error.message}`, {
      bookingId: req.params.id,
      userId: req.user?.id
    });
    next(error);
  }
};

export const canViewProperty = async (req, res, next) => {
  try {
    if (!req.body?.propertyId) {
      throw new NotFoundError('Property ID is required');
    }

    const property = await prisma.property.findUnique({
      where: { id: req.body.propertyId },
      select: { 
        status: true, 
        ownerId: true,
        visibility: true
      }
    });

    if (!property) {
      throw new NotFoundError('Property not found');
    }

    // Check Casbin permissions
    const hasPermission = await casbinRBAC.hasAccess(
      req.user.id,
      `properties/${req.body.propertyId}`,
      'read'
    );

    if (!hasPermission) {
      throw new ForbiddenError('Not authorized to view this property');
    }

    // Additional visibility checks
    if (property.visibility === 'PRIVATE' && 
        property.ownerId !== req.user.id &&
        !req.user.roles.includes('ADMIN')) {
      throw new ForbiddenError('Property is private');
    }

    next();
  } catch (error) {
    logger.error(`Property view policy check failed: ${error.message}`, {
      propertyId: req.body?.propertyId,
      userId: req.user?.id
    });
    next(error);
  }
};

export const canViewBookings = async (req, res, next) => {
  try {
    // Admins can view all bookings
    if (req.user.roles.includes('ADMIN')) {
      return next();
    }

    // Check Casbin permissions for listing
    const hasPermission = await casbinRBAC.hasAccess(
      req.user.id,
      'bookings',
      'list'
    );

    if (!hasPermission) {
      throw new ForbiddenError('Not authorized to view bookings');
    }

    // Regular users can only view their own bookings
    if (req.query.userId && req.query.userId !== req.user.id) {
      throw new ForbiddenError('Not authorized to view these bookings');
    }

    // Ensure regular users don't try to filter by other users
    if (!req.query.userId) {
      req.query.userId = req.user.id;
    }

    next();
  } catch (error) {
    logger.error(`Bookings list policy check failed: ${error.message}`, {
      userId: req.user?.id
    });
    next(error);
  }
};

// Export enforcer for direct policy management if needed
export { enforcer };