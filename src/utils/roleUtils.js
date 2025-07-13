export const validateRoleHierarchy = (existingRole, updateData) => {
  if (updateData.parentRoleId) {
    if (existingRole.isSystem) {
      throw new Error("System roles cannot have parent roles");
    }
    if (updateData.parentRoleId === existingRole.id) {
      throw new Error("Circular role hierarchy");
    }
  }
};
