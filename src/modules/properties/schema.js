// properties/validation.js
import Joi from "joi";

// Reusable validation schemas
export const propertySchema = Joi.object({
  title: Joi.string().min(5).max(120).required(),
  listingType: Joi.string().valid("RENT", "SALE").required(),
  description: Joi.string().min(20).max(2000).required(),
  basePrice: Joi.number().positive().required(),
  currency: Joi.string().length(3).default("USD"),
  address: Joi.string().max(255).required(),
  city: Joi.string().max(100).required(),
  state: Joi.string().max(100).required(),
  country: Joi.string().max(100).required(),
  postalCode: Joi.string()
    .pattern(/^[0-9]{5}(-[0-9]{4})?$/)
    .required(),
  propertyType: Joi.string().valid(
    "apartment",
    "house",
    "condo",
    "townhouse",
    "villa",
    "cabin",
    "chalet",
    "studio",
    "loft",
    "land",
    "commercial",
    "duplex"
  ).optional(),
  maxGuests: Joi.number().integer().positive().required(),
  minStay: Joi.number().integer().positive().required(),
  maxStay: Joi.number().integer().positive().optional(),
  amenities: Joi.array().items(Joi.string()).optional(),
  location: Joi.alternatives().try(
    // Old format: { lat, lng }
    Joi.object({
      lat: Joi.number().min(-90).max(90).required(),
      lng: Joi.number().min(-180).max(180).required(),
    }),
    // New GeoJSON format: { type: "Point", coordinates: [lng, lat] }
    Joi.object({
      type: Joi.string().valid("Point").required(),
      coordinates: Joi.array().items(Joi.number()).length(2).required(),
      crs: Joi.object().optional(),
    }),
    // Extended format with both coordinates and lat/lng
    Joi.object({
      type: Joi.string().valid("Point").required(),
      coordinates: Joi.array().items(Joi.number()).length(2).required(),
      lat: Joi.number().min(-90).max(90).optional(),
      lng: Joi.number().min(-180).max(180).optional(),
      crs: Joi.object().optional(),
    })
  ).required(),
  photos: Joi.array().items(Joi.string().uri()).optional(),
  virtualTours: Joi.array().items(Joi.string().uri()).optional(),
  sizeSqft: Joi.number().positive().required(),
});

// Reusable validation function
export const validateWithJoi = (schema, data) => {
  const options = {
    abortEarly: false, // Return all errors, not just the first one
    allowUnknown: false, // Disallow unknown keys
    stripUnknown: true, // Remove unknown keys
  };

  return schema.validate(data, options);
};

export const searchParamsSchema = Joi.object({
  query: Joi.string().trim().optional(),
  latitude: Joi.number().min(-90).max(90).optional(),
  longitude: Joi.number().min(-180).max(180).optional(),
  radius: Joi.number().integer().min(100).max(50000).default(5000),
  minPrice: Joi.number().min(0).optional(),
  maxPrice: Joi.number().min(0).optional(),
  minBedrooms: Joi.number().integer().min(0).optional(),
  amenities: Joi.alternatives()
    .try(Joi.string(), Joi.array().items(Joi.string()))
    .optional(),
  propertyType: Joi.string().optional(),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
}).with("latitude", "longitude");

export const suggestionsSchema = Joi.object({
  terms: Joi.string().required().messages({
    "string.empty": "Search terms are required",
    "any.required": "Search terms are required",
  }),
});

export const reindexSchema = Joi.object({
  propertyId: Joi.string()
    .uuid({
      version: ["uuidv4", "uuidv5"],
    })
    .required()
    .messages({
      "string.guid": "Invalid property ID format",
      "any.required": "Property ID is required",
    }),
});
