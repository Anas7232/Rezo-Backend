import convict from "convict";
import dotenv from "dotenv";

dotenv.config(); // Load .env variables

const config = convict({
  env: {
    doc: "The application environment.",
    format: ["production", "development", "test"],
    default: "development",
    env: "NODE_ENV",
  },
  port: {
    doc: "The port the server runs on",
    format: "port",
    default: 8000,
    env: "PORT",
  },
  databaseUrl: {
    doc: "Database connection URL",
    format: String,
    default: "",
    env: "DATABASE_URL",
  },
  jwtSecret: {
    doc: "JWT Secret Key for Access Token",
    format: String,
    default: "your_jwt_secret",
    env: "JWT_SECRET",
    sensitive: true,
  },
  refreshSecret: {
    doc: "JWT Secret Key for Refresh Token",
    format: String,
    default: "your_refresh_secret",
    env: "REFRESH_SECRET",
    sensitive: true,
  },
  jwtAccessExpiration: {
    doc: "JWT Access Token Expiration Time in milliseconds",
    format: Number,
    default: 900000, // 15 minutes in milliseconds
    env: "JWT_ACCESS_EXPIRATION",
  },
  jwtRefreshExpiration: {
    doc: "JWT Refresh Token Expiration Time in milliseconds",
    format: Number,
    default: 604800000,
    env: "JWT_REFRESH_EXPIRATION",
  },
  jwtIssuer: {
    doc: "JWT Issuer",
    format: String,
    default: "your_jwt_issuer",
    env: "JWT_ISSUER",
  },
  jwtAudience: {
    doc: "JWT Audience",
    format: String,
    default: "your_jwt_audience",
    env: "JWT_AUDIENCE",
  },
  redisUrl: {
    doc: "Redis connection URL",
    format: String,
    default: "",
    env: "REDIS_URL",
  },
  frontendUrl: {
    doc: "Frontend URL",
    format: String,
    default: "http://localhost:3000",
    env: "FRONTEND_URL",
  },
  googleClientId: {
    doc: "Google Client ID",
    format: String,
    default:
      "1073930846177-docvkc3l97sa6didhrrrr7jkr07302vq.apps.googleusercontent.com",
    env: "GOOGLE_CLIENT_ID",
  },
  googleClientSecret: {
    doc: "Google Client Secret",
    format: String,
    default: "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",
    env: "GOOGLE_CLIENT_SECRET",
    sensitive: true,
  },
  googleCallbackURL: {
    doc: "Google OAuth callback URL",
    format: String,
    default: "http://localhost:3000/api/auth/google/callback",
    env: "GOOGLE_CALLBACK_URL",
  },
  email: {
    host: {
      doc: "Email SMTP host",
      format: String,
      default: "smtp.ethereal.email",
      env: "MAIL_HOST",
    },
    port: {
      doc: "Email SMTP port",
      format: "port",
      default: 2525,
      env: "MAIL_PORT",
    },
    secure: {
      doc: "Email SMTP secure connection",
      format: Boolean,
      default: false,
      env: "EMAIL_SECURE",
    },
    user: {
      doc: "Email SMTP user",
      format: String,
      default: "",
      env: "MAIL_USER",
    },
    pass: {
      doc: "Email SMTP password",
      format: String,
      default: "",
      env: "MAIL_PASS",
      sensitive: true,
    },
  },
  casbin: {
    policyVersion: "1.0.0",
    reloadInterval: 300000, // 5 minutes
    defaultRole: "guest",
    requiredPolicies: [
      { role: "admin", resource: "*", action: "*" },
      { role: "user", resource: "profile", action: "read" },
    ],
  },
  mongodb: {
    doc: "MongoDB connection URL",
    format: String,
    default: "",
    env: "MONGODB_URI",
  },
  sessionSecrate: {
    default: "your_session_secret",
    doc: "Session secret key",
    format: String,
    env: "SESSION_SECRET",
  },
  frontendSuccessUrl: {
    doc: "Frontend success URL",
    format: String,
    default: "http://localhost:3000/",
    env: "FRONTEND_SUCCESS_URL",
  },
  login:{
    maxAttempts: {
      doc: "Max login attempts",
      format: Number,
      default: 5,
      env: "LOGIN_MAX_ATTEMPTS",
    },
    banTime: {
      doc: "Lock time in milliseconds",
      format: Number,
      default: 300, // 1 minute
      env: "LOGIN_LOCK_TIME",
    },
  }
});

// Perform validation
config.validate({ allowed: "strict" });

export default config;
