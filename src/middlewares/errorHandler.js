import { isApiError } from "../utils/apiError.js";
import { logger } from "../config/logger.js";

export const errorHandler = (err, req, res, next) => {
  if (isApiError(err)) {
    return err.format(res);
  }
  // Log unexpected errors with stack and request info
  logger.error("❌ Unexpected Error:", err, {
    url: req.originalUrl,
    method: req.method,
    headers: req.headers,
    stack: err.stack,
  });

  const isProd = process.env.NODE_ENV === 'production' || process.env.env === 'production';
  res.status(500).json({
    success: false,
    message: isProd ? "Internal Server Error" : (err.message || "Internal Server Error"),
    stack: isProd ? undefined : err.stack,
    timestamp: new Date().toISOString(),
  });
};
