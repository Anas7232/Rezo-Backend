// middlewares/authentication.js
import passport from "passport";
import prisma from "../config/database.js";
import logger from "../config/logger.js";
import { initializeCasbin } from "../config/casbin.js";
import config from "../config/env.js";
import jwt from "jsonwebtoken";
import {
  AuthError,
  PermissionError,
  NotFoundError,
} from "../utils/apiError.js";
import { validate as isUUID } from "uuid";

// Initialize Casbin enforcer with retry logic
let enforcer;
const MAX_RETRIES = 3;
let retryCount = 0;

const initializeEnforcer = async () => {
  try {
    enforcer = await initializeCasbin();
    logger.info("Casbin enforcer initialized successfully");
  } catch (error) {
    if (retryCount < MAX_RETRIES) {
      retryCount++;
      logger.warn(
        `Casbin initialization failed, retrying (${retryCount}/${MAX_RETRIES})`
      );
      setTimeout(initializeEnforcer, 5000);
    } else {
      logger.error("Casbin initialization failed after retries", error);
      process.exit(1);
    }
  }
};
initializeEnforcer();

// ==================================================
// Resource Pattern Resolution
// ==================================================
function resolveResourcePattern(pattern, req) {
  if (!pattern) {
    throw new Error("Resource pattern is required");
  }

  return pattern
    .split("/")
    .map((segment) => {
      if (segment.startsWith(":")) {
        const paramName = segment.slice(1);
        const paramValue = req.params[paramName] || req.body[paramName];
        if (!paramValue) {
          logger.warn(`Missing parameter ${paramName} in request`, {
            params: req.params,
            body: req.body,
          });
          throw new Error(`Missing required parameter: ${paramName}`);
        }
        return paramValue;
      }
      return segment;
    })
    .join("/");
}
// ==================================================
// Enhanced Authentication Middleware
// ==================================================
export const authenticateUser = (options = {}) => {
  return (req, res, next) => {
    console.log('AUTH MIDDLEWARE CALLED for', req.originalUrl);
    // Add logging for debugging
    console.log('AUTH HEADER:', req.headers.authorization);
    const requireVerified = options.requireVerified ?? true;
    const requireMFA = options.requireMFA ?? false;
    const allowedRoles = options.roles || [];

    passport.authenticate(
      "jwt",
      { session: false, failWithError: true },
      async (error, user, info) => {
        try {
          if (error || !user) {
            console.error('AUTH ERROR:', error, info);
            logger.warn(
              `Authentication failed: ${info?.message || "Unknown error"}`,
              {
                ip: req.ip,
                path: req.path,
              }
            );
            return next(new AuthError("Authentication failed"));
          }

          // Fetch complete user with roles
          const fullUser = await prisma.user.findUnique({
            where: { id: user.id },
            include: {
              roles: {
                include: {
                  role: {
                    include: {
                      permissions: {
                        include: {
                          permission: true,
                        },
                      },
                    },
                  },
                },
              },
              profile: true,
            },
          });

          if (!fullUser) {
            throw new AuthError("User not found");
          }

          // Check account status
          if (!fullUser.isActive) {
            throw new PermissionError("Account deactivated");
          }

          // Check verification status
          if (requireVerified && !fullUser.isVerified) {
            throw new PermissionError("Account not verified");
          }

          // Check MFA status
          if (requireMFA && !fullUser.mfaEnabled) {
            throw new PermissionError("MFA required");
          }

          // Check role restrictions
          if (allowedRoles.length > 0) {
            const hasRole = fullUser.roles.some((userRole) =>
              allowedRoles.includes(userRole.role.name)
            );
            if (!hasRole) {
              throw new PermissionError("Insufficient privileges");
            }
          }

          // Attach enriched user object
          req.user = {
            ...fullUser,
            permissions: fullUser.roles.flatMap((userRole) =>
              userRole.role.permissions.map((rp) => ({
                resource: rp.permission.resource,
                action: rp.permission.action,
                conditions: rp.conditions,
              }))
            ),
          };

          // Add logging for debugging
          console.log('DECODED USER:', req.user);

          next();
        } catch (error) {
          next(error);
        }
      }
    )(req, res, next);
  };
};

// ==================================================
// Enhanced Authorization Middleware
// ==================================================
export const authorizeAccess = (resourcePattern, action, options = {}) => {
  return async (req, res, next) => {
    try {
      // 1. System readiness check
      if (!enforcer) {
        logger.error("Authorization system not ready");
        return res.status(503).json({
          error: "Service Unavailable",
          message: "Authorization system is initializing",
          code: "AUTHZ_INITIALIZING",
        });
      }

      // 2. Authentication verification
      const user = req.user;
      if (!user) {
        return res.status(401).json({
          error: "Unauthorized",
          message: "User not authenticated",
          code: "USER_NOT_AUTHENTICATED",
        });
      }

      // 3. Resource resolution
      const resolvedResource = resolveResourcePattern(resourcePattern, req);
      const resolvedAction = action || req.method.toLowerCase();

      // 4. Ownership verification (if resource has ID)
      if (options.checkOwnership !== false && resourcePattern.includes(":id")) {
        await verifyOwnership(resolvedResource, req, user);
      }

      // 5. Permission check with ABAC conditions
      const hasAccess = await checkAccessWithConditions(
        user,
        resolvedResource,
        resolvedAction,
        req
      );

      if (!hasAccess) {
        logger.warn(
          `Forbidden: ${user.id} -> ${resolvedResource} [${resolvedAction}]`
        );
        return res.status(403).json({
          error: "Forbidden",
          message: "Insufficient permissions",
          code: "PERMISSION_DENIED",
          required: `${resolvedAction}:${resolvedResource}`,
        });
      }

      // 6. Audit logging
      await createAuditLog(
        req,
        user,
        resolvedResource,
        resolvedAction,
        user.id
      );

      next();
    } catch (error) {
      logger.error(`Authorization error: ${error.message}`, {
        stack: error.stack,
        userId: req.user?.id,
        resource: resourcePattern,
      });

      if (error instanceof NotFoundError) {
        return res.status(404).json({
          error: "Not Found",
          message: error.message,
          code: "RESOURCE_NOT_FOUND",
        });
      }

      res.status(500).json({
        error: "Internal Server Error",
        message: "An unexpected error occurred",
        code: "SERVER_ERROR",
      });
    }
  };
};

// ==================================================
// Enhanced Helper Functions
// ==================================================
async function checkAccessWithConditions(user, resource, action, request) {
  // First check direct permissions
  const hasDirectAccess = await enforcer.enforce(user.id, resource, action);

  if (hasDirectAccess) return true;

  // Check role-based permissions with conditions
  for (const permission of user.permissions) {
    if (permission.resource === resource && permission.action === action) {
      if (!permission.conditions) return true;

      // Evaluate ABAC conditions
      if (evaluateConditions(permission.conditions, request)) {
        return true;
      }
    }
  }

  return false;
}

function evaluateConditions(conditions, request) {
  // Implement your ABAC condition evaluation logic
  // Example: Check request params, user attributes, etc.
  return true; // Simplified for this example
}

async function verifyOwnership(resource, req, user) {
  const [resourceType, resourceId] = resource.split("/");

  switch (resourceType) {
    case "properties":
      const property = await prisma.property.findUnique({
        where: { id: resourceId },
        select: { ownerId: true },
      });

      if (!property) {
        throw new NotFoundError("Property not found");
      }

      if (property.ownerId !== user.id) {
        throw new PermissionError("Ownership verification failed");
      }
      break;

    case "bookings":
      const booking = await prisma.booking.findUnique({
        where: { id: resourceId },
        select: { tenantId: true, property: { select: { ownerId: true } } },
      });

      if (!booking) {
        throw new NotFoundError("Booking not found");
      }

      if (
        booking.tenantId !== user.id &&
        booking.property.ownerId !== user.id
      ) {
        throw new PermissionError("Not authorized to access this booking");
      }
      break;

    case "reviews":
      const review = await prisma.review.findUnique({
        where: { id: resourceId },
        select: { tenantId: true, property: { select: { ownerId: true } } },
      });

      if (!review) {
        throw new NotFoundError("Review not found");
      }

      if (review.tenantId !== user.id && review.property.ownerId !== user.id) {
        throw new PermissionError("Not authorized to access this review");
      }
      break;

    default:
      throw new PermissionError(
        "Ownership verification not supported for this resource"
      );
  }
}

async function createAuditLog(req, user, resource, action, entityId, oldValues = null, newValues = null) {

  try {
    const data = {
      actionType: action.toUpperCase(),
      entityType: resource.split("/")[0].toUpperCase(),
      userId: user.id, // Use userId instead of user.connect
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"] || null,
      // Store metadata in newValues if needed
      newValues: {
        method: req.method,
        path: req.path,
        params: req.params,
        query: req.query,
        resource,
        action,
      },
      oldValues: oldValues,
      // createdAt is automatically set by the schema default
    };

    // Only add entityId if provided
    if (entityId) {
      data.entityId = entityId;
    }

    await prisma.auditLog.create({ data });
  } catch (error) {
    logger.error("Failed to create audit log:", error);
    // Consider re-throwing the error if you want calling code to handle it
    throw error;
  }
}

// ==================================================
// Strict JWT Validation with Enhanced Security
// ==================================================
export const strictJWT = (options = {}) => {
  return (req, res, next) => {
    const authHeader = req.headers["authorization"];
    const token = authHeader?.startsWith("Bearer ")
      ? authHeader.slice(7)
      : null;

    if (!token) {
      return res.status(401).json({
        error: "Unauthorized",
        message: "Missing authorization token",
        code: "TOKEN_MISSING",
      });
    }

    try {
      const decoded = jwt.verify(token, config.get("jwtSecret"), {
        algorithms: ["HS256"],
        issuer: config.get("jwtIssuer"),
        audience: config.get("jwtAudience"),
        clockTolerance: 30, // 30 seconds tolerance
        maxAge: options.maxAge || "7d",
      });

      if (decoded.type !== "access") {
        return res.status(401).json({
          error: "Unauthorized",
          message: "Invalid token type",
          code: "INVALID_TOKEN_TYPE",
        });
      }

      // Additional security checks
      if (options.checkIP && decoded.ip !== req.ip) {
        return res.status(401).json({
          error: "Unauthorized",
          message: "Token IP mismatch",
          code: "IP_MISMATCH",
        });
      }

      req.jwtPayload = decoded;
      next();
    } catch (error) {
      const response = {
        error: "Unauthorized",
        message:
          error.name === "TokenExpiredError"
            ? "Token expired"
            : "Invalid token",
        code:
          error.name === "TokenExpiredError"
            ? "TOKEN_EXPIRED"
            : "INVALID_TOKEN",
      };

      res
        .status(401)
        .header(
          "Clear-Site-Data",
          '"cache", "cookies", "storage", "executionContexts"'
        )
        .json(response);
    }
  };
};

export default {
  authenticateUser,
  authorizeAccess,
  strictJWT,
};
