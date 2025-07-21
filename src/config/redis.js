import Redis from "ioredis";
import config from "./env.js";
import { logger } from "./logger.js";

let redis;
let host, port;

// Get Redis URL from config
const redisUrl = config.get("redisUrl");

if (redisUrl) {
  // Use Redis URL
  try {
    const parsedUrl = new URL(redisUrl);
    host = parsedUrl.hostname;
    port = parseInt(parsedUrl.port, 10);

    redis = new Redis(redisUrl, {
      retryStrategy: (times) => Math.min(times * 100, 3000),
      tls: parsedUrl.protocol === "rediss:" ? {} : undefined,
      maxRetriesPerRequest: null,
      enableOfflineQueue: true,
    });

    redis.options.scaleReads = 'slave';
  } catch (error) {
    logger.error("❌ Invalid REDIS_URL:", error);
    throw error;
  }
} else {
  // Fallback to REDIS_HOST + REDIS_PORT
  host = config.get("redisHost") || "localhost";
  port = parseInt(config.get("redisPort") || "6379", 10);

  redis = new Redis({
    host,
    port,
    retryStrategy: (times) => Math.min(times * 100, 3000),
    maxRetriesPerRequest: null,
    enableOfflineQueue: true,
  });

  redis.options.scaleReads = 'slave';
}

// Redis event listeners
redis.on("connect", () => {
  logger.info(`✅ Connected to Redis at ${host}:${port}`);
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
