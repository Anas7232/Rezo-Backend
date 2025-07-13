import express from "express";
import {
  register,
  verifyEmail,
  login,
  refreshAccessToken,
  logout,
  requestPasswordReset,
  resetPassword,
  googleAuthCallback,
} from "./controller.js";
import passport from "passport";
import rateLimit from "express-rate-limit";
import requestContext from "../../middlewares/context.js";
import validate from "../../middlewares/validate.js";
import authSchemas from "./schemas.js";
import { authenticateUser as authMiddleware } from "../../middlewares/authentication.js";
import { guestMiddleware } from "../../middlewares/guestMiddleware.js";
import crypto from "crypto";
import config from "../../config/env.js";
import logger from "../../config/logger.js";
import prisma from "../../config/database.js";
import { generateRefreshToken } from "../../utils/generateToken.js";
// Rate limiting configuration
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // Limit each IP to 20 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
});

const router = express.Router();

// Public routes with rate limiting and context
router.use(requestContext);
/**
 * @openapi
 * /auth/register:
 *   post:
 *     tags: [Authentication]
 *     summary: Register a new user
 *     description: Create a new user account
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/RegisterRequest'
 *     responses:
 *       201:
 *         description: User registered successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AuthResponse'
 *       400:
 *         description: Validation error
 *       429:
 *         description: Too many requests
 */
router.post(
  "/register",
  authLimiter,
  validate(authSchemas.registerSchema),
  register
);
/**
 * @openapi
 * /auth/login:
 *   post:
 *     tags: [Authentication]
 *     summary: Authenticate user
 *     description: Log in with email and password
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/LoginRequest'
 *     responses:
 *       200:
 *         description: Authentication successful
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AuthResponse'
 *       400:
 *         description: Invalid credentials
 *       401:
 *         description: Unauthorized
 *       429:
 *         description: Too many requests
 */

router.post(
  "/login",
  authLimiter,
  guestMiddleware(),
  validate(authSchemas.loginSchema),
  login
);
/**
 * @openapi
 * /auth/verify-email:
 *   post:
 *     tags: [Authentication]
 *     summary: Verify email address
 *     description: Verify user's email address with verification token
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/VerifyEmailRequest'
 *     responses:
 *       200:
 *         description: Email verified successfully
 *       400:
 *         description: Invalid token
 *       429:
 *         description: Too many requests
 */
router.post(
  "/verify-email",
  guestMiddleware(),
  authLimiter,
  validate(authSchemas.verifyEmailSchema),
  verifyEmail
);
/**
 * @openapi
 * /auth/refresh-token:
 *   post:
 *     tags: [Authentication]
 *     summary: Refresh access token
 *     description: Generate new access token using refresh token
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/RefreshTokenRequest'
 *     responses:
 *       200:
 *         description: New tokens generated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AuthResponse'
 *       400:
 *         description: Invalid refresh token
 *       401:
 *         description: Unauthorized
 */
router.post(
  "/refresh-token",
  validate(authSchemas.refreshTokenSchema),
  refreshAccessToken
);
/**
 * @openapi
 * /auth/password-reset:
 *   post:
 *     tags: [Authentication]
 *     summary: Request password reset
 *     description: Initiate password reset flow
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/PasswordResetRequest'
 *     responses:
 *       200:
 *         description: Password reset email sent
 *       400:
 *         description: Invalid email
 *       429:
 *         description: Too many requests
 */

// Password reset flow
router.post(
  "/password-reset",
  authLimiter,
  validate(authSchemas.passwordResetRequestSchema),
  requestPasswordReset
);
/**
 * @openapi
 * /auth/password-reset/confirm:
 *   post:
 *     tags: [Authentication]
 *     summary: Confirm password reset
 *     description: Complete password reset with token
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/PasswordResetConfirm'
 *     responses:
 *       200:
 *         description: Password reset successful
 *       400:
 *         description: Invalid token
 *       429:
 *         description: Too many requests
 */
router.post(
  "/password-reset/confirm",
  authLimiter,
  validate(authSchemas.passwordResetConfirmSchema),
  resetPassword
);
/**
 * @openapi
 * /auth/google:
 *   get:
 *     tags: [Authentication]
 *     summary: Initiate Google OAuth
 *     description: Redirect to Google for authentication
 *     responses:
 *       302:
 *         description: Redirect to Google
 */

router.get("/google", (req, res, next) => {
  try {
    // Enhanced session verification
    if (!req.session) {
      const error = new Error("Session middleware not configured");
      error.code = "SESSION_ERROR";
      throw error;
    }

    // Generate state with enhanced entropy
    const state = crypto.randomBytes(32).toString("hex");
    req.session.oauthState = state;



    // Create the authenticator with explicit parameters
    const authenticator = passport.authenticate("google", {
      scope: ["profile", "email", "openid"],
      accessType: "offline",
      prompt: "consent",
      state: state,
      callbackURL: config.get("googleCallbackURL"), // Explicitly set
    });

    // Execute authentication
    authenticator(req, res, next);
  } catch (error) {
    console.error("OAuth Initiation Error:", {
      message: error.message,
      stack: error.stack,
      code: error.code,
    });
    next(error);
  }
});

/**
 * @openapi
 * /auth/google/callback:
 *   get:
 *     tags: [Authentication]
 *     summary: Google OAuth callback
 *     description: Handle Google OAuth callback
 *     responses:
 *       200:
 *         description: Authentication successful
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AuthResponse'
 *       400:
 *         description: Authentication failed
 */

router.get(
  "/google/callback",
  // State validation middleware
  (req, res, next) => {


    if (!req.query.state || req.query.state !== req.session.oauthState) {
      console.warn("State parameter mismatch");
      return res.redirect("/api/auth/error?code=invalid_state");
    }
    next();
  },

  // Authentication handler
  (req, res, next) => {
    passport.authenticate(
      "google",
      {
        failureRedirect: "/api/auth/error",
        failureMessage: true,
      },
      async (err, user, info) => {
        try {

          if (err) {
            console.error("Authentication error:", err);
            return res.redirect("/api/auth/error?code=auth_error");
          }

          if (!user) {
            console.error("No user returned - Info:", info);
            return res.redirect("/api/auth/error?code=no_user");
          }

          // Ensure user object is properly structured
          const completeUser = await prisma.user.findUnique({
            where: { id: user.id },
            include: {
              roles: {
                include: {
                  role: true,
                },
              },
            },
          });

          if (!completeUser) {
            console.error("User not found in database after auth");
            return res.redirect("/api/auth/error?code=user_not_found");
          }

          // Add this line to ensure proper serialization
          req.user = completeUser;

          req.logIn(completeUser, (loginErr) => {
            if (loginErr) {
              console.error("Login error:", loginErr);
              return next(loginErr);
            }
            next();
          });
        } catch (error) {
          console.error("Auth callback processing error:", error);
          return res.redirect("/api/auth/error?code=processing_error");
        }
      }
    )(req, res, next);
  },

  // Session creation handler
  async (req, res) => {
    try {

      const sessionToken = crypto.randomBytes(32).toString("hex");
      const refreshToken = generateRefreshToken(req.user.id); // Generate refresh token
      await prisma.session.create({
        data: {
          userId: req.user.id,
          sessionToken,
          deviceInfo: req.headers["user-agent"],
          ipAddress: req.ip,
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
          refreshToken, // Add this
        },
      });

      res.cookie("session_token", sessionToken, {
        httpOnly: true,
        secure: config.get("env") === "production",
        sameSite: "lax",
        maxAge: 30 * 24 * 60 * 60 * 1000,
      });

      res.redirect(config.get("frontendSuccessUrl"));
    } catch (error) {
      console.error("Session creation failed:", error);
      res.redirect("/api/auth/error?code=session_error");
    }
  }
);
// Add this temporary route to see the full OAuth URL being generated
router.get("/google/debug", (req, res) => {
  const state = crypto.randomBytes(16).toString("hex");
  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams(
    {
      response_type: "code",
      client_id: config.get("googleClientId"),
      redirect_uri: config.get("googleCallbackURL"),
      scope: "profile email",
      state: state,
      access_type: "offline",
      prompt: "consent",
    }
  )}`;

  res.json({ authUrl });
});

router.get("/google/verify", (req, res) => {
  try {
    const configCheck = {
      success: true,
      googleClientId: !!config.get("googleClientId"),
      googleCallbackURL: config.get("googleCallbackURL"),
      registeredURIs: [
        "http://localhost:3000/api/auth/google/callback",
        "http://localhost:3000/auth/google/callback",
      ],
      exactMatch:
        config.get("googleCallbackURL") ===
        "http://localhost:3000/api/auth/google/callback",
      env: config.get("env"),
    };

    res.json(configCheck);
  } catch (error) {
    console.error("Verification error:", error);
    res.status(500).json({
      success: false,
      message: "Configuration verification failed",
      error: error.message,
    });
  }
});

router.get("/google/callback/test", (req, res) => {
  try {
    res.json({
      success: true,
      message: "Callback route is working",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Callback test error:", error);
    res.status(500).json({
      success: false,
      message: "Callback test failed",
      error: error.message,
    });
  }
});
router.get("/error", (req, res) => {
  const errorCode = req.query.code || "unknown_error";
  res.status(400).json({ error: `Authentication failed: ${errorCode}` });
});
// Authenticated routes
router.use(authMiddleware());
/**
 * @openapi
 * /auth/logout:
 *   post:
 *     tags: [Authentication]
 *     summary: Log out user
 *     description: Invalidate user session and tokens
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Logout successful
 *       401:
 *         description: Unauthorized
 */
router.post("/logout", logout);

export default router;
