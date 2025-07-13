import {
  registerUser,
  loginUser,
  refreshToken as refreshTokenService,
  logoutUser,
  verifyEmailService,
  requestPasswordResetService,
  resetPasswordService,
} from "./service.js";
import logger from "../../config/logger.js";
import config from "../../config/env.js";
import { ValidationError } from "../../utils/apiError.js";

const setRefreshTokenCookie = (res, token) => {
  res.cookie("refreshToken", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/api/auth/refresh",
    maxAge: config.get("jwtRefreshExpiration") * 1000,
  });
};

export const register = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        code: "MISSING_CREDENTIALS",
        message: "Email and password are required",
      });
    }

    const result = await registerUser({ email, password });

    res.status(201).json({
      success: true,
      message: "Registration successful. Check email for verification code.",
      data: {
        userId: result.id,
        email: result.email,
        verificationRequired: true,
      },
    });
  } catch (error) {
    logger.error(`Registration error: ${error.message}`);

    const status = error.statusCode || 500;
    const response = {
      success: false,
      code: error.code || "REGISTRATION_ERROR",
      message: error.message,
    };

    if (process.env.NODE_ENV === "development") {
      response.stack = error.stack;
    }

    res.status(status).json(response);
  }
};

export const verifyEmail = async (req, res) => {
  try {
    const { code } = req.body;

    if (!code || code.length !== 6) {
      return res.status(400).json({
        success: false,
        code: "INVALID_OTP_FORMAT",
        message: "Verification code must be 6 digits",
      });
    }

    const context = {
      ipAddress: req.ip,
      deviceInfo: req.headers["user-agent"],
    };

    const { accessToken, refreshToken, user } = await verifyEmailService(
      code,
      context
    );

    setRefreshTokenCookie(res, refreshToken);

    res.json({
      success: true,
      message: "Email verified successfully",
      data: {
        user: {
          id: user.id,
          email: user.email,
          isVerified: user.isVerified,
        },
        accessToken,
      },
    });
  } catch (error) {
    logger.error(`Email verification error: ${error.message}`);

    const status = error instanceof ValidationError ? 400 : 500;
    res.status(status).json({
      success: false,
      code: "VERIFICATION_FAILED",
      message: error.message,
    });
  }
};

export const login = async (req, res) => {
  try {
    const { email, password } = req.body;
    const context = {
      ipAddress: req.ip,
      deviceInfo: req.headers["user-agent"],
    };

    const result = await loginUser(email, password, context);
    if (result.mfaRequired) {
      return res.status(202).json({
        success: true,
        code: "MFA_REQUIRED",
        message: "2FA authentication required",
      });
    }

    setRefreshTokenCookie(res, result.refreshToken);

    res.json({
      success: true,
      data: {
        user: result.user,
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        sessionId: result.sessionId,
        roles: result.roles,
        defaultRole: result.defaultRole,
      },
    });
  } catch (error) {
    logger.error(`Login error: ${error.message}`);

    const status = error.statusCode || 401;
    res.status(status).json({
      success: false,
      code: "AUTHENTICATION_FAILED",
      message: error.message,
    });
  }
};

export const refreshAccessToken = async (req, res) => {
  try {
    const token = req.cookies.refreshToken || req.body.refreshToken;
    const context = {
      ipAddress: req.ip,
      deviceInfo: req.headers["user-agent"],
    };

    const { accessToken, refreshToken } = await refreshTokenService(
      token,
      context
    );

    setRefreshTokenCookie(res, refreshToken);

    res.json({
      success: true,
      data: { accessToken, refreshToken },
    });
  } catch (error) {
    logger.error(`Token refresh error: ${error.message}`);

    res.clearCookie("refreshToken");
    res.status(401).json({
      success: false,
      code: "TOKEN_REFRESH_FAILED",
      message: "Session expired. Please login again.",
    });
  }
};

export const logout = async (req, res) => {
  try {
    await logoutUser(req.user.id, req.user.sessionId);

    res.clearCookie("refreshToken", {
      path: "/api/auth/refresh",
      domain: process.env.COOKIE_DOMAIN,
    });

    res.json({
      success: true,
      message: "Successfully logged out",
    });
  } catch (error) {
    logger.error(`Logout error: ${error.message}`);
    res.status(500).json({
      success: false,
      code: "LOGOUT_FAILED",
      message: "Failed to terminate session",
    });
  }
};

export const requestPasswordReset = async (req, res) => {
  try {
    const { email } = req.body;
    await requestPasswordResetService(email);

    res.json({
      success: true,
      message: "If account exists, reset instructions will be sent",
    });
  } catch (error) {
    logger.error(`Password reset request error: ${error.message}`);
    res.status(500).json({
      success: false,
      code: "RESET_REQUEST_FAILED",
      message: "Failed to process reset request",
    });
  }
};

export const resetPassword = async (req, res) => {
  try {
    const { code, newPassword } = req.body;
    const context = { ipAddress: req.ip };

    await resetPasswordService(code, newPassword, context);

    res.clearCookie("refreshToken");

    res.json({
      success: true,
      message: "Password reset successful. Please login with new credentials.",
    });
  } catch (error) {
    logger.error(`Password reset error: ${error.message}`);

    const status = error instanceof ValidationError ? 400 : 500;
    res.status(status).json({
      success: false,
      code: "PASSWORD_RESET_FAILED",
      message: error.message,
    });
  }
};

export const googleAuthCallback = (req, res) => {
  try {
    const { accessToken, refreshToken, user } = req.authInfo;

    setRefreshTokenCookie(res, refreshToken);

    res.redirect(
      `${config.get("frontendUrl")}/auth/success?token=${accessToken}`
    );
  } catch (error) {
    logger.error(`Google auth error: ${error.message}`);
    res.redirect(`${config.get("frontendUrl")}/auth/error?code=OAUTH_FAILED`);
  }
};
