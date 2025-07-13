// middlewares/validate.js
import Joi from "joi";
import { logger } from "../config/logger.js";

const validate = (schema) => async (req, res, next) => {
  const validationOptions = {
    abortEarly: false,
    allowUnknown: true,
    stripUnknown: true,
  };

  try {
    // Ensure validation works whether schema has `.validateAsync()` or only `.validate()`
    const value = schema.validateAsync
      ? await schema.validateAsync(req.body, validationOptions)
      : schema.validate(req.body, validationOptions).value;

    req.body = value; // Assign sanitized value to req.body
    return next();
  } catch (error) {
    logger.error(`❌ Validation error: ${error.message}`);

    const errors = error.details?.map((detail) => ({
      field: detail.context?.key || "unknown",
      message: detail.message.replace(/['"]/g, ""),
    })) || [{ field: "unknown", message: "Validation failed" }];

    return res.status(400).json({
      success: false,
      code: "VALIDATION_ERROR",
      message: "Invalid request data",
      errors,
    });
  }
};

export default validate;
