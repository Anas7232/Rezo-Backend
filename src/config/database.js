import { PrismaClient } from "@prisma/client";
import { logger } from "./logger.js";
import config from "./env.js";

// Initialize Prisma with logging events
const prisma = new PrismaClient({
  log: [
    { level: "warn", emit: "event" },
    { level: "error", emit: "event" },
  ],
  datasources: {
    db: {
      url: config.get("databaseUrl") + `&connection_limit=20&pool_timeout=10`,
    },
  },
});

// Prisma event logging
prisma.$on("warn", (e) => logger.warn(`⚠️ Prisma Warning: ${e.message}`));
prisma.$on("error", (e) => logger.error(`❌ Prisma Error: ${e.message}`));

// Database connection function
export const connectDB = async () => {
  try {
    await prisma.$connect();
    logger.info(`✅ Connected to PostgreSQL at ${config.get("databaseUrl")}`);
  } catch (error) {
    logger.error("❌ Database connection failed", error);
    process.exit(1); // Exit process if DB connection fails
  }
};

// Disconnect database
export const disconnectDB = async () => {
  await prisma.$disconnect();
  logger.info("🛑 Database connection closed");
};

export default prisma;
