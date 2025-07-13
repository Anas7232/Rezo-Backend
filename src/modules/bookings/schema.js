import Joi from "joi";
import { DateTime } from "luxon";

// Custom Joi extensions for Luxon date validation
const luxonDateExtension = (joi) => {
  return {
    type: "luxonDate",
    base: joi.string(),
    messages: {
      "luxonDate.invalid":
        "{{#label}} must be a valid date in YYYY-MM-DD format",
      "luxonDate.min": "{{#label}} must be on or after {{#min}}",
      "luxonDate.max": "{{#label}} must be on or before {{#max}}",
      "luxonDate.future": "{{#label}} must be in the future",
    },
    coerce(value, helpers) {
      // Only attempt to coerce if the value is a string
      if (typeof value !== "string") {
        return { value };
      }

      const date = DateTime.fromISO(value);
      if (!date.isValid) {
        return { errors: [helpers.error("luxonDate.invalid")] };
      }

      return { value: date };
    },
    rules: {
      minDate: {
        method(min) {
          return this.$_addRule({ name: "minDate", args: { min } });
        },
        args: [
          {
            name: "min",
            ref: true,
            assert: (value) => {
              if (DateTime.isDateTime(value)) return true;
              const dt = DateTime.fromISO(value);
              return dt.isValid;
            },
            message: "must be a valid date",
          },
        ],
        validate(value, helpers, { min }) {
          const minDate = DateTime.isDateTime(min)
            ? min
            : DateTime.fromISO(min);
          if (value < minDate) {
            return helpers.error("luxonDate.min", { min: minDate.toISODate() });
          }
          return value;
        },
      },
      maxDate: {
        method(max) {
          return this.$_addRule({ name: "maxDate", args: { max } });
        },
        args: [
          {
            name: "max",
            ref: true,
            assert: (value) => {
              if (DateTime.isDateTime(value)) return true;
              const dt = DateTime.fromISO(value);
              return dt.isValid;
            },
            message: "must be a valid date",
          },
        ],
        validate(value, helpers, { max }) {
          const maxDate = DateTime.isDateTime(max)
            ? max
            : DateTime.fromISO(max);
          if (value > maxDate) {
            return helpers.error("luxonDate.max", { max: maxDate.toISODate() });
          }
          return value;
        },
      },
      futureDate: {
        method() {
          return this.$_addRule("futureDate");
        },
        validate(value, helpers) {
          if (value <= DateTime.now()) {
            return helpers.error("luxonDate.future");
          }
          return value;
        },
      },
    },
  };
};

// Extend Joi with our custom type
const extendedJoi = Joi.extend(luxonDateExtension);

// Define validation schemas
export const bookingSchemas = {
  createBooking: extendedJoi
    .object({
      propertyId: extendedJoi
        .string()
        .guid({
          version: ["uuidv4"],
        })
        .required()
        .messages({
          "string.guid": "Property ID must be a valid UUID",
          "any.required": "Property ID is required",
        }),
      startDate: extendedJoi.luxonDate().required().futureDate().messages({
        "any.required": "Start date is required",
        "luxonDate.future": "Start date must be in the future",
      }),
      endDate: extendedJoi
        .luxonDate()
        .required()
        .minDate(extendedJoi.ref("startDate"))
        .messages({
          "any.required": "End date is required",
          "luxonDate.min": "End date must be after start date",
        }),
      adults: extendedJoi
        .number()
        .integer()
        .min(1)
        .max(10)
        .required()
        .messages({
          "number.min": "At least 1 adult is required",
          "number.max": "Maximum 10 adults allowed",
        }),
      children: extendedJoi.number().integer().min(0).max(5).default(0),
      infants: extendedJoi.number().integer().min(0).max(3).default(0),
      specialRequests: extendedJoi.string().max(500).optional(),
    })
    .custom((value, helpers) => {
      if (value.children + value.infants > value.adults * 2) {
        return helpers.error("any.invalid", {
          message: "Too many children/infants per adult (max 2 per adult)",
        });
      }
      return value;
    }),

    updateBooking: extendedJoi
    .object({
      startDate: extendedJoi.luxonDate().optional().futureDate(),
      endDate: extendedJoi
        .luxonDate()
        .optional()
        .when("startDate", {
          is: extendedJoi.exist(),
          then: extendedJoi.luxonDate().min(extendedJoi.ref("startDate")),
          otherwise: extendedJoi.forbidden(),
        }),
      adults: extendedJoi.number().integer().min(1).max(10).optional(),
      children: extendedJoi.number().integer().min(0).max(5).optional(),
      infants: extendedJoi.number().integer().min(0).max(3).optional(),
      specialRequests: extendedJoi.string().max(500).optional(),
    })
    .min(1)
    .message("At least one field must be provided"),

  bookingIdParam: extendedJoi.object({
    id: extendedJoi
      .string()
      .guid({
        version: ["uuidv4"],
      })
      .required(),
  }),

  checkAvailability: extendedJoi.object({
    startDate: extendedJoi.luxonDate().optional().futureDate(),
    endDate: extendedJoi
      .luxonDate()
      .required()
      .min(extendedJoi.ref("startDate")),
  }),
};

// Validation middleware
// Validation middleware remains the same
export const validate = (schema) => {
  return (req, res, next) => {
    // Handle both wrapped schemas and direct schemas
    const bodySchema = schema.body || schema;
    const paramsSchema = schema.params;
    const querySchema = schema.query;

    const validationSources = {};
    if (paramsSchema) validationSources.params = req.params;
    if (bodySchema) validationSources.body = req.body;
    if (querySchema) validationSources.query = req.query;

    // Determine which schema to use for validation
    const validationSchema = bodySchema || paramsSchema || querySchema;

    if (!validationSchema || typeof validationSchema.validate !== 'function') {
      return res.status(500).json({
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid validation schema",
        },
      });
    }

    const { error, value } = validationSchema.validate(validationSources, {
      abortEarly: false,
      allowUnknown: false,
      stripUnknown: true,
    });

    if (error) {
      const errors = error.details.map((err) => ({
        field: err.path.join("."),
        message: err.message,
      }));

      return res.status(400).json({
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Validation failed",
          details: errors,
        },
      });
    }

    // Assign validated values back to request
    if (value.params) req.params = value.params;
    if (value.body) req.body = value.body;
    if (value.query) req.query = value.query;

    next();
  };
};