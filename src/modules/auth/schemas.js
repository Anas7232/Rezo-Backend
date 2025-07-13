import Joi from 'joi';

export default {
  registerSchema: Joi.object({
    email: Joi.string().email().required(),
    password: Joi.string().pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/).required()
  }),
  
  loginSchema: Joi.object({
    email: Joi.string().email().required(),
    password: Joi.string().required()
  }),
  
  verifyEmailSchema: Joi.object({
    code: Joi.string().length(6).required()
  }),
  
  refreshTokenSchema: Joi.object({
    refreshToken: Joi.string().optional()
  }),
  
  passwordResetRequestSchema: Joi.object({
    email: Joi.string().email().required()
  }),
  
  passwordResetConfirmSchema: Joi.object({
    code: Joi.string().length(6).required(),
    newPassword: Joi.string().pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/).required()
  })
};