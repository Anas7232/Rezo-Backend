import swaggerJsDoc from "swagger-jsdoc";
import swaggerUi from "swagger-ui-express";
import config from "./env.js";
import logger from "./logger.js";

const swaggerOptions = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Padsplit API",
      version: "1.0.0",
      description: "Enterprise Role-Based Access Control Management System",
      contact: {
        name: "API Support",
        email: "api-support@padsplit.com",
        url: "https://support.padsplit.com",
      },
      license: {
        name: "Proprietary",
        url: "https://padsplit.com/license",
      },
    },
    servers: [
      {
        url: `${config.get("frontendUrl")}:${config.get("port")}`,
        description: `${config.get("env")} server`,
      },
      {
        url: "https://api.padsplit.com/v1",
        description: "Production server",
      },
    ],
    components: {
      securitySchemes: {
        BearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description: "JWT Authorization header using the Bearer scheme",
        },
      },
      schemas: {
        Role: {
          type: "object",
          required: ["name"],
          properties: {
            id: {
              type: "string",
              format: "uuid",
              example: "550e8400-e29b-41d4-a716-446655440000",
            },
            name: {
              type: "string",
              maxLength: 50,
              example: "content-moderator",
            },
            description: {
              type: "string",
              maxLength: 255,
              example: "Content moderation team role",
            },
            isDefault: {
              type: "boolean",
              default: false,
            },
            isSystem: {
              type: "boolean",
              default: false,
            },
          },
        },
        Permission: {
          type: "object",
          required: ["resource", "action"],
          properties: {
            resource: {
              type: "string",
              example: "articles",
              maxLength: 100,
            },
            action: {
              type: "string",
              example: "delete",
              maxLength: 50,
            },
            description: {
              type: "string",
              maxLength: 255,
            },
          },
        },
        RolePermission: {
          type: "object",
          required: ["roleId", "permissionId"],
          properties: {
            conditions: {
              type: "object",
              description: "ABAC conditions in JSON format",
              example: {
                time: {
                  $lt: "18:00",
                },
              },
            },
          },
        },
        Error: {
          type: "object",
          properties: {
            code: {
              type: "string",
              example: "AUTH_001",
            },
            message: {
              type: "string",
              example: "Authentication failed",
            },
            details: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  field: { type: "string" },
                  message: { type: "string" },
                },
              },
            },
          },
        },
      },
      responses: {
        UnauthorizedError: {
          description: "Invalid or missing authentication credentials",
        },
        ForbiddenError: {
          description: "Insufficient permissions for the request",
        },
      },
    },
    security: [
      {
        BearerAuth: [],
      },
    ],
    tags: [
      { name: "Roles", description: "Role management operations" },
      { name: "Permissions", description: "Permission management operations" },
      { name: "RBAC", description: "Role-based access control operations" },
      {
        name: "Authentication",
        description: "Authentication Management Module",
      },
    ],
  },
  apis: ["./src/routes/*.js", "./src/models/*.js"],
};

const swaggerSpec = swaggerJsDoc(swaggerOptions);

export const swaggerDocs = (app) => {
  // JSON endpoint
  app.get("/api-docs.json", (req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.send(swaggerSpec);
  });

  // UI setup
  const options = {
    explorer: true,
    swaggerOptions: {
      validatorUrl: null,
      persistAuthorization: true,
      docExpansion: "none",
    },
  };

  app.use(
    "/api-docs",
    swaggerUi.serveFiles(swaggerSpec, options),
    swaggerUi.setup(swaggerSpec, options)
  );

  logger.info(
    `📚 API documentation available at ${config.get(
      "frontendUrl"
    )}/api-docs`
  );
};
