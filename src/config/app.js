import express from "express";
import helmet from "helmet";
import cors from "cors";
import { rateLimit } from "express-rate-limit";
import logger, { httpLogger } from "./logger.js";
import prisma, { connectDB as connectPostgres } from "./database.js";
import redis from "./redis.js";
import routes from "../modules/index.js";
import bodyParser from "body-parser";
import cookieParser from "cookie-parser";
import { errorHandler } from "../middlewares/errorHandler.js";
import initializePassport from "./passport.js";
import passport from "passport";
import { swaggerDocs } from "./swagger.js";
import { initializeCasbin } from "../config/casbin.js";
import { connectMongoDB, disconnectMongoDB } from "./mongodb.js";
import mongoose from "mongoose";
import { setupWebSocket, getIO } from "../websocket/index.js";
import { sessionMiddleware } from "./session.js";
const app = express();

// ========================
// Security Middleware
// ========================

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "https://*.valid-cdn.com"],
        connectSrc: ["'self'", "https://*.valid-api.com"],
      },
    },
  })
);
app.set('trust proxy', true);
// ========================
// Session Middleware
// =========================
app.use(sessionMiddleware);

// ========================
// CORS Configuration
// ========================
// temprarily disabled for local development
app.use(
  cors({
    origin: ["https://www.smare.org", "http://localhost:3000"], // Allow both frontend and backend
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);
app.options("*", cors());
//
//=====================================
// Initialize Casbin on startup
//======================================
initializeCasbin();
// ========================
// Passport Middleware
// ========================
initializePassport(passport);
app.use(passport.initialize());
app.use(passport.session());

// ========================
// Request Parsing
// ========================
app.use(cookieParser());
app.use(express.json({ limit: "10kb" }));
app.use(express.urlencoded({ extended: true }));
app.use(bodyParser.urlencoded({ extended: true }));

// ========================
// Logging
// ========================
app.use(httpLogger);

// ========================
// Database Connections
// ========================

(async () => {
  try {
    await connectPostgres();
    await connectMongoDB();
    console.log("✅ Database connections established");
  } catch (err) {
    console.error("❌ Failed to connect to database(s):", err);
    process.exit(1);
  }
})();

// ========================
// Enhanced Health Check
// ========================
app.get("/server-health", (req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.get("/", async (req, res) => {
  const healthCheck = {
    status: "ok",
    timestamp: new Date().toISOString(),
    services: {
      postgresql: "unhealthy",
      mongodb: "unhealthy",
      redis: "unhealthy",
    },
  };

  try {
    // PostgreSQL Check
    await prisma.$queryRaw`SELECT 1`;
    healthCheck.services.postgresql = "healthy";
  } catch (error) {
    healthCheck.status = "degraded";
    logger.error("PostgreSQL health check failed:", error);
  }

  try {
    if (mongoose.connection.readyState === 1) {
      healthCheck.services.mongodb = "healthy";
    } else {
      healthCheck.status = "degraded";
      logger.error("MongoDB is not connected properly.");
    }
  } catch (error) {
    healthCheck.status = "degraded";
    logger.error("MongoDB health check failed:", error);
  }

  // Redis Check
  try {
    const redisPing = await redis.ping();
    healthCheck.services.redis = redisPing === "PONG" ? "healthy" : "unhealthy";
  } catch (error) {
    healthCheck.status = "degraded";
    logger.error("Redis health check failed:", error);
  }

  // Determine overall status
  if (Object.values(healthCheck.services).every((s) => s === "healthy")) {
    healthCheck.status = "ok";
  } else if (
    Object.values(healthCheck.services).some((s) => s === "unhealthy")
  ) {
    healthCheck.status = "degraded";
  }

  res.status(healthCheck.status === "ok" ? 200 : 503).json(healthCheck);
});

// ========================
// Application Routes
// ========================
app.use("/api", routes);

// ========================
// Error Handling
// ========================
app.use(errorHandler);
swaggerDocs(app);
export default app;
