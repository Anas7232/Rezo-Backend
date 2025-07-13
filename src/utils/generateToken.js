import jwt from "jsonwebtoken";
import config from "../config/env.js";
import crypto from "crypto";
import logger from "../config/logger.js";

// Validate required configuration
const validateConfig = () => {
  if (!config.get("jwtSecret") || !config.get("refreshSecret")) {
    logger.error("JWT secrets are not configured properly");
    throw new Error("Authentication configuration error");
  }
};
validateConfig();

export const generateAccessToken = (userId, roles = []) => {
  return jwt.sign(
    {
      sub: userId,                         // Subject (user ID)
      roles,                               // User roles
      jti: crypto.randomBytes(16).toString("hex"),  // Unique token identifier
      type: "access",                      // Token type
      iss: config.get("jwtIssuer"),        // Issuer
      aud: config.get("jwtAudience"),      // Audience
      iat: Math.floor(Date.now() / 1000),  // Issued at
    },
    config.get("jwtSecret"),
    {
      expiresIn: config.get("jwtAccessExpiration") || "15m",
      algorithm: "HS256",                  // Explicit algorithm selection
    }
  );
};

export const generateRefreshToken = (userId) => {
  return jwt.sign(
    {
      sub: userId,
      jti: crypto.randomBytes(16).toString("hex"),
      type: "refresh",
      iss: config.get("jwtIssuer"),
      aud: config.get("jwtAudience"),
      iat: Math.floor(Date.now() / 1000),
    },
    config.get("refreshSecret"),
    {
      expiresIn: config.get("jwtRefreshExpiration") || "7d",
      algorithm: "HS256",
    }
  );
};

export const generateSecureToken = (length = 32) => {
  if (length < 16) {
    logger.warn("Insecure token length requested");
    throw new Error("Token length must be at least 16 characters");
  }
  return crypto.randomBytes(length).toString("hex");
};

export const generateOTP = (options = {}) => {
  const config = {
    length: options.length || 6,
    type: options.type || "numeric",
    upperCase: options.upperCase || false,
  };

  const chars = {
    numeric: "0123456789",
    alphanumeric: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789",
    custom: options.customChars || "",
  };

  let pool = chars[config.type] || chars.numeric;
  if (config.upperCase) pool = pool.toUpperCase();
  
  return Array.from(crypto.randomFillSync(new Uint32Array(config.length)))
    .map((x) => pool[x % pool.length])
    .join("");
};

// Token validation utility
export const verifyToken = (token, secret, options = {}) => {
  return jwt.verify(token, secret, {
    ...options,
    algorithms: ["HS256"],                 // Only allow HS256
    issuer: config.get("jwtIssuer"),
    audience: config.get("jwtAudience"),
    clockTolerance: 30,                    // 30-second grace period
  });
};