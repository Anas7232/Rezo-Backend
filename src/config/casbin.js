// config/casbin.js
import { newEnforcer } from "casbin";
import { PrismaAdapter } from "casbin-prisma-adapter";
import path from "path";
import config from "./env.js"; // Make sure to import your config
import logger from "./logger.js";

// Cache the enforcer promise for singleton use
let enforcerPromise = null;

// Production-ready Casbin initialization
export const initializeCasbin = async () => {
  if (enforcerPromise) return enforcerPromise; // Prevent reinitialization

  enforcerPromise = (async () => {
    try {
      const adapter = await PrismaAdapter.newAdapter({
        datasourceUrl: config.get("databaseUrl"),
      });

      const modelPath = path.resolve("./src/config/casbin/model.conf");
      const enforcer = await newEnforcer(modelPath, adapter);
      if (!enforcer.getModel()) throw new Error("Failed to load Casbin model");
      if ((await enforcer.getPolicy()).length === 0) {
        await enforcer.addPolicies([
          // Super Admin wildcard policy
          ["superAdmin", "*", "*"],
          // Default deny policy
          ["*", "*", "*", "deny"],
        ]);
        await enforcer.savePolicy();
      }
      const policies = await enforcer.getNamedPolicy("p");
      if (!policies.some((p) => p[1] === "*")) {
        logger.error("No fallback policy found");
        throw new Error("Missing default policy");
      }
      enforcer.enableAutoSave(true);

      if (config.get("env") === "production") {
        setInterval(async () => {
          await enforcer.loadPolicy();
        }, 300000);
      }

      return enforcer;
    } catch (error) {
      console.error("Casbin initialization failed:", error);
      enforcerPromise = null; // ✅ Reset the singleton so it can retry later
      process.exit(1);
    }
  })();

  return enforcerPromise;
};

// RBAC helper functions with error handling
export const casbinRBAC = {
  getRolesForUser: async (userId) => {
    try {
      const enforcer = await initializeCasbin();
      const roles = await enforcer.getRolesForUser(userId);
      return roles.length ? roles : ["guest"]; // ✅ Return a default role if empty
    } catch (error) {
      console.error("Role retrieval failed:", error);
      return ["guest"]; // ✅ Return a fallback role instead of crashing
    }
  },

  getPermissions: async (userId) => {
    try {
      const enforcer = await initializeCasbin();
      return enforcer.getImplicitPermissionsForUser(userId);
    } catch (error) {
      console.error("Permission retrieval failed:", error);
      return [];
    }
  },

  hasAccess: async (userId, resource, action) => {
    try {
      const enforcer = await initializeCasbin();
      return enforcer.enforce(userId, resource, action);
    } catch (error) {
      console.error("Access check failed:", error);
      return false;
    }
  },
};

initializeCasbin().then((enforcer) => {
  logger.info("✅ Casbin policy loaded successfully");

  // Add proper environment check
  if (config.get("env") === "development") {
    enforcer.enableLog(true);
    logger.info("Casbin request logging enabled");
  }
});
export class CasbinPolicyManager {
  constructor() {
    this.enforcer = null;
  }

  // ✅ Initialize the enforcer using the existing initializeCasbin function
  // ✅ Initialize using the existing singleton
  async initialize() {
    try {
      // Get the initialized enforcer from the singleton
      this.enforcer = await initializeCasbin();
      if (!this.enforcer) {
        throw new Error("Casbin enforcer not initialized");
      }
      return this.enforcer;
    } catch (error) {
      throw new ConfigurationError(
        `Casbin initialization failed: ${error.message}`
      );
    }
  }

  // ✅ Add proper policy management methods
  async addPermissionForUser(resource, action) {
    if (!this.enforcer) {
      throw new ConfigurationError("Casbin enforcer not initialized");
    }
    await this.enforcer.addPolicy("admin", resource, action);
  }

  // ✅ Update permission with proper enforcer reference
  async updatePermission(oldResource, oldAction, newResource, newAction) {
    if (!this.enforcer) {
      throw new ConfigurationError("Casbin enforcer is not initialized");
    }
    await this.enforcer.removePolicy("admin", oldResource, oldAction);
    await this.enforcer.addPolicy("admin", newResource, newAction);
    logger.info(`✅ Updated permission: ${oldResource} → ${newResource}`);
  }

  // ✅ Remove permission with proper enforcer reference
  async removePermission(resource, action) {
    if (!this.enforcer) {
      throw new ConfigurationError("Casbin enforcer is not initialized");
    }
    await this.enforcer.removePolicy("admin", resource, action);
    logger.info(`✅ Removed permission: ${resource} - ${action}`);
  }

  // ✅ Check if enforcer is initialized
  get isInitialized() {
    return !!this.enforcer;
  }
}
