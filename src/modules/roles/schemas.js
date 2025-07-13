// src/modules/roles/validation.schemas.js
import Joi from 'joi';
import { BadRequestError } from '../../utils/apiError.js';
const idRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/;
/**
 * Core validation schemas for Role operations
 */
const roleBaseSchema = Joi.object({
  name: Joi.string()
    .trim()
    .min(3)
    .max(50)
    .regex(/^[a-zA-Z0-9_-]+$/)
    .messages({
      'string.pattern.base': 'Role name can only contain letters, numbers, underscores, and hyphens',
      'string.empty': 'Role name is required',
      'string.min': 'Role name must be at least {#limit} characters',
      'string.max': 'Role name cannot exceed {#limit} characters'
    }),
    
  description: Joi.string()
    .trim()
    .max(255)
    .allow('')
    .optional()
    .messages({
      'string.max': 'Description cannot exceed {#limit} characters'
    }),
    
  isDefault: Joi.boolean()
    .default(false)
    .messages({
      'boolean.base': 'isDefault must be a boolean value'
    }),
    
  isSystem: Joi.boolean()
    .default(false)
    .messages({
      'boolean.base': 'isSystem must be a boolean value'
    })
}).options({ stripUnknown: true });

/**
 * Validation schemas for specific operations
 */
const createRoleSchema = roleBaseSchema.keys({
  name: Joi.required(),
  isDefault: Joi.boolean().default(false),
  isSystem: Joi.boolean().default(false)
});

const updateRoleSchema = roleBaseSchema.keys({
  // name: Joi.forbidden().messages({
  //   'any.unknown': 'Role name cannot be modified after creation'
  // }),
  isSystem: Joi.forbidden().messages({
    'any.unknown': 'System role flag cannot be modified'
  })
});

/**
 * ID parameter validation schema
 */
const idParamSchema = Joi.object({
  id: Joi.string()
    .required()
    .pattern(idRegex)
    .message('Invalid role ID format')
}).options({ allowUnknown: true });

/**
 * Query parameter validation schema
 */
const roleQuerySchema = Joi.object({
  includePermissions: Joi.boolean().default(false),
  includeUsers: Joi.boolean().default(false),
  page: Joi.number().min(1).default(1),
  limit: Joi.number().min(1).max(100).default(25)
}).options({ stripUnknown: true });

/**
 * Validation middleware functions
 * @param {Object} schema - Joi schema to validate against
 * @returns {Function} Middleware function
 */
const validate = (schema) => (req, res, next) => {
  const { value, error } = schema.validate(req, {
    abortEarly: false,
    allowUnknown: true
  });

  if (error) {
    const errorMessages = error.details.map(detail => ({
      field: detail.path.join('.'),
      message: detail.message
    }));
    return next(new BadRequestError('Validation Error', errorMessages));
  }

  // Update request with sanitized values
  Object.assign(req, value);
  next();
};

export {
  roleBaseSchema,
  createRoleSchema,
  updateRoleSchema,
  idParamSchema,
  roleQuerySchema,
  validate
};