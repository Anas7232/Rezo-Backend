import Joi from "joi";

// ✅ Schema for creating/updating a permission
export const permissionSchema = Joi.object({
  resource: Joi.string().max(100).required(),
  action: Joi.string().max(50).required(),
  description: Joi.string().max(255).optional(),
});

// ✅ Middleware to validate request data
export function validatePermission(req, res, next) {
  const { error } = permissionSchema.validate(req.body);
  if (error) return res.status(400).json({ error: error.details[0].message });
  next();
}
