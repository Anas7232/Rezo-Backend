import mongoose from "mongoose";
import { logger } from "./logger.js";
import config from "./env.js";

// MongoDB connection options
const mongoOptions = {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  // replicaSet: "rs0",
  socketTimeoutMS: 30000,
  connectTimeoutMS: 30000,
  readPreference: "secondaryPreferred",
  retryWrites: true,
  w: "majority",
};

// Initialize MongoDB connection
export const connectMongoDB = async () => {
  try {
    await mongoose.connect(config.get("mongodb"), mongoOptions);
    logger.info(`✅ Connected to MongoDB at ${config.get("mongodb")}`);
  } catch (error) {
    logger.error("❌ MongoDB connection failed", error);
    process.exit(1); // Exit process if DB connection fails
  }
};

// Disconnect MongoDB
export const disconnectMongoDB = async () => {
  await mongoose.disconnect();
  logger.info("🛑 MongoDB connection closed");
};

// MongoDB event logging
mongoose.connection.on("connected", () => {
  logger.info("✅ MongoDB connection established");
});

mongoose.connection.on("error", (error) => {
  logger.error(`❌ MongoDB connection error: ${error.message}`);
});

mongoose.connection.on("disconnected", () => {
  logger.warn("🛑 MongoDB connection disconnected");
});

mongoose.connection.on("reconnected", () => {
  logger.info("🔁 MongoDB reconnected");
});

mongoose.connection.on("reconnectFailed", () => {
  logger.error("❌ MongoDB reconnection failed");
});

// Export Mongoose instance
export default mongoose;
