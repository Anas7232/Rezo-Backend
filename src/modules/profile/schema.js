import Joi from "joi";
// import { countries } from './countries.js';
// import { timezones } from './timezones.js';

const genderEnum = [
  "MALE",
  "FEMALE",
  "NON_BINARY",
  "OTHER",
  "PREFER_NOT_TO_SAY",
];

export const profileSchema = Joi.object({
  firstName: Joi.string()
    .max(50)
    .pattern(/^[a-zA-Z\-' ]+$/)
    .messages({
      "string.pattern.base": "First name contains invalid characters",
      "string.max": "First name cannot exceed 50 characters",
    }),

  lastName: Joi.string()
    .max(50)
    .pattern(/^[a-zA-Z\-' ]+$/)
    .messages({
      "string.pattern.base": "Last name contains invalid characters",
      "string.max": "Last name cannot exceed 50 characters",
    }),

  phone: Joi.string()
    .pattern(/^\+?[1-9]\d{1,14}$/)
    .messages({
      "string.pattern.base":
        "Phone number must be in valid international format",
    }),

  avatarUrl: Joi.string().uri().max(255).messages({
    "string.uri": "Avatar URL must be a valid URL",
    "string.max": "Avatar URL cannot exceed 255 characters",
  }),

  dateOfBirth: Joi.date().max("now").iso().messages({
    "date.max": "Date of birth must be in the past",
    "date.iso": "Date of birth must be in ISO format",
  }),

  gender: Joi.string()
    .valid(...genderEnum)
    .default("OTHER"),

  emergencyContact: Joi.string().max(100).allow(null, ""),

  nationality: Joi.string().max(50).allow(null, ""),

  currentAddress: Joi.string().max(255).allow(null, ""),

  city: Joi.string().max(50).allow(null, ""),

  state: Joi.string().max(50).allow(null, ""),
  country: Joi.string().max(50).allow(null, ""),
  cnicNumber: Joi.string().max(13).allow(null, "").min(13),
  // natonality: Joi.string().max(50).allow(null, ""),

  // country: Joi.string()
  //   .valid(...countries)
  //   .messages({
  //     'any.only': 'Invalid country code'
  //   }),

  postalCode: Joi.string().max(20).allow(null, ""),

  // timeZone: Joi.string()
  //   .valid(...timezones)
  //   .messages({
  //     'any.only': 'Invalid timezone'
  //   }),

  notificationPreferences: Joi.object({
    email: Joi.boolean().default(true),
    push: Joi.boolean().default(true),
    sms: Joi.boolean().default(false),
    inApp: Joi.boolean().default(true),
    frequency: Joi.string()
      .valid("INSTANT", "DAILY", "WEEKLY")
      .default("INSTANT"),
  }).default({}),
}).options({ abortEarly: false });

export const profileUpdateSchema = profileSchema.fork(
  Object.keys(profileSchema.describe().keys),
  (schema) => schema.optional()
);
