export const sanitizeOutput = (data, removeFields = [], transformMap = {}) => {
  const sanitized = { ...data };

  // Remove sensitive fields
  removeFields.forEach((field) => delete sanitized[field]);

  // Apply transformations
  Object.entries(transformMap).forEach(([key, transform]) => {
    if (sanitized[key]) {
      sanitized[key] = transform(sanitized[key]);
    }
  });

  return sanitized;
};
