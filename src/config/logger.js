import winston from "winston";
import morgan from "morgan";
import config from "./env.js";
import path from "path";
import fs from "fs";

const { combine, timestamp, json, errors } = winston.format;

// Ensure logs directory exists
const logDirectory = path.join(process.cwd(), "logs");
if (!fs.existsSync(logDirectory)) {
    fs.mkdirSync(logDirectory);
}

// Define transports
const transports = [
  new winston.transports.Console({
    level: config.get("env") === "production" ? "info" : "debug"
  }),
  new winston.transports.File({ 
    filename: path.join(logDirectory, "combined.log"),
    level: "info"
  }),
  new winston.transports.File({ 
    filename: path.join(logDirectory, "errors.log"), 
    level: "error" 
  })
];

// Create Winston Logger
export const logger = winston.createLogger({
  level: "info",
  format: combine(
    errors({ stack: true }),
    timestamp(),
    json()
  ),
  transports
});

// Morgan HTTP request logging
export const httpLogger = morgan(config.get("env") === "production" ? "combined" : "dev", {
  stream: {
    write: (message) => logger.info(message.trim())
  }
});

export default logger