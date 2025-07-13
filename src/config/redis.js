import Redis from "ioredis";
import config from "./env.js";
import { logger } from "./logger.js";

// Parse Redis URL for logging purposes
const redisUrl = config.get("redisUrl");
const parsedUrl = new URL(redisUrl);
const host = parsedUrl.hostname;
const port = parseInt(parsedUrl.port, 10);

// Initialize Redis with retry strategy
const redis = new Redis(redisUrl, {
  retryStrategy: (times) => Math.min(times * 100, 3000),
  tls: parsedUrl.protocol === "rediss:" ? {} : undefined, // Enable TLS for Redis Cloud
  maxRetriesPerRequest: null,
  enableOfflineQueue: true,
});

// Redis event listeners
redis.options.scaleReads = 'slave';
redis.on("connect", () => {
  logger.info(`✅ Connected to Redis at ${host}:${port}`);
  if (parsedUrl.password) {
    logger.debug("🔐 Using authenticated Redis connection");
  }
});

redis.on("error", (err) => {
  logger.error(`❌ Redis connection error (${host}:${port}):`, err);
});

redis.on("ready", () => {
  logger.debug("🔄 Redis connection ready");
});

redis.on("reconnecting", (delay) => {
  logger.warn(`⚠️ Redis reconnecting in ${delay}ms`);
});

// Function to manually connect to Redis
export const connectRedis = async () => {
  if (redis.status !== "ready") {
    try {
      await redis.connect();
      logger.info("✅ Redis manually connected");
    } catch (error) {
      logger.error("❌ Redis manual connection failed:", error);
      throw error;
    }
  }
};

// Function to disconnect Redis
export const disconnectRedis = async () => {
  if (redis.status === "ready") {
    await redis.quit();
    logger.info("🛑 Redis connection closed");
  }
};

// Test Redis connection during startup
export const testRedisConnection = async () => {
  try {
    await redis.ping();
    logger.debug("✅ Redis ping successful");
  } catch (error) {
    logger.error("❌ Redis connection test failed:", error);
    throw error;
  }
};

export default redis;
