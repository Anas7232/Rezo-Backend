import { Strategy as JwtStrategy, ExtractJwt } from "passport-jwt";
import { PrismaClient } from "@prisma/client";
import config from "./env.js";
import GoogleStrategy from "passport-google-oauth20";
import logger from "../config/logger.js";
import { v4 as uuidv4 } from "uuid";

const prisma = new PrismaClient();

const jwtOptions = {
  jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
  secretOrKey: config.get("jwtSecret"),
  issuer: config.get("jwtIssuer"),
  audience: config.get("jwtAudience"),
  algorithms: ["HS256"],
};

export default (passport) => {
  // JWT Strategy with enhanced security
  passport.use(
    new JwtStrategy(jwtOptions, async (jwt_payload, done) => {
      try {
        // Debug: print the incoming JWT payload
        console.log('JWT PAYLOAD:', jwt_payload);
        // Validate token type
        if (jwt_payload.type !== "access") {
          console.log('Invalid token type:', jwt_payload.type);
          return done(null, false, { message: "Invalid token type" });
        }

        const user = await prisma.user.findUnique({
          where: { id: jwt_payload.sub },
          include: {
            roles: {
              include: {
                role: {
                  include: { permissions: true },
                },
              },
            },
            sessions: {
              where: {
                expiresAt: { gt: new Date() },
              },
            },
          },
        });

        // Debug: print user lookup result
        console.log('USER LOOKUP RESULT:', user);

        // Validate user status
        if (!user) {
          console.log('User not found for id:', jwt_payload.sub);
          return done(null, false, { message: "User not found" });
        }
        if (!user.isActive) {
          console.log('Account deactivated for user:', user.id);
          return done(null, false, { message: "Account deactivated" });
        }
        if (!user.isVerified) {
          console.log('Account unverified for user:', user.id);
          return done(null, false, { message: "Account unverified" });
        }

        // Validate active session
        if (user.sessions.length === 0) {
          console.log('No active session for user:', user.id);
          return done(null, false, { message: "No active session" });
        }

        return done(null, user);
      } catch (error) {
        console.error('JWT AUTH ERROR:', error);
        logger.error(`JWT Authentication Error: ${error.message}`);
        return done(error, false);
      }
    })
  );

  // Enhanced Google OAuth Strategy with robust error handling

  passport.use(
    new GoogleStrategy(
      {
        clientID: config.get("googleClientId"),
        clientSecret: config.get("googleClientSecret"),
        callbackURL: config.get("googleCallbackURL"),
        passReqToCallback: true,
        scope: ["profile", "email"],
      },
      async (req, accessToken, refreshToken, profile, done) => {
        try {
          // Validate required profile data
          if (!profile.emails?.[0]?.value) {
            throw new Error("No email in Google profile");
          }

          const email = profile.emails[0].value;
          const googleId = profile.id;

          // Check for existing user
          let user = await prisma.user.findUnique({
            where: { email },
            include: {
              roles: {
                include: {
                  role: true,
                },
              },
            },
          });

          if (user) {
            // Update existing user with Google ID if missing
            if (!user.googleId) {
              user = await prisma.user.update({
                where: { id: user.id },
                data: { googleId },
                include: {
                  roles: {
                    include: {
                      role: true,
                    },
                  },
                },
              });
            }

            // Check if user has at least one role
            if (user.roles.length === 0) {
              await assignDefaultRole(user.id);
            }

            return done(null, user);
          }

          // Create new user
          const defaultRole = await prisma.role.findFirst({
            where: { isDefault: true },
          });

          if (!defaultRole) {
            throw new Error("Default role not found in database");
          }

          // Generate unique username
          const baseUsername = email.split("@")[0];
          const uniqueUsername = await generateUniqueUsername(baseUsername);

          // Create system user ID for assignment
          const systemUserId =
            "00000000-0000-0000-0000-000000000000" || uuidv4();

          user = await prisma.user.create({
            data: {
              email,
              googleId,
              username: uniqueUsername,
              isVerified: true,
              isActive: true,
              profile: {
                create: {
                  firstName: profile.name?.givenName || "",
                  lastName: profile.name?.familyName || "",
                  avatarUrl: profile.photos?.[0]?.value || "",
                },
              },
              roles: {
                create: {
                  roleId: defaultRole.id,
                  assignedBy: systemUserId, // Using a valid UUID
                },
              },
            },
            include: {
              roles: {
                include: {
                  role: true,
                },
              },
            },
          });

          // Create audit log
          await createAuditLog(
            user.id,
            "REGISTER",
            req.ip,
            req.headers["user-agent"]
          );

          return done(null, user, user.id);
        } catch (error) {
          console.error("Google OAuth error:", error);
          return done(error, null);
        }
      }
    )
  );

  // Helper function to assign default role
  async function assignDefaultRole(userId) {
    const defaultRole = await prisma.role.findFirst({
      where: { isDefault: true },
    });

    if (!defaultRole) {
      throw new Error("Default role not found");
    }

    // Create system user ID for assignment
    const systemUserId = uuidv4();

    await prisma.userRole.create({
      data: {
        userId,
        roleId: defaultRole.id,
        assignedBy: systemUserId,
      },
    });
  }

  // Helper function to generate unique username
  async function generateUniqueUsername(baseUsername) {
    let username = baseUsername;
    let counter = 1;

    while (true) {
      const existingUser = await prisma.user.findUnique({
        where: { username },
      });

      if (!existingUser) {
        return username;
      }

      username = `${baseUsername}${counter}`;
      counter++;
    }
  }

  passport.serializeUser((user, done) => {
    try {
      if (!user || !user.id) {
        throw new Error("Invalid user object in serialization");
      }

      const serializedUser = {
        id: user.id,
        // Safely access nested session ID
        sessionId: user.sessions?.[0]?.id || null,
      };

      done(null, serializedUser);
    } catch (error) {
      console.error("Serialization error:", error);
      done(error);
    }
  });

  // Correct deserializeUser implementation
  passport.deserializeUser(async (serializedUser, done) => {
    try {
      // Handle case where just the ID string was serialized
      const userId =
        typeof serializedUser === "string"
          ? serializedUser
          : serializedUser?.id;

      if (!userId) {
        return done(new Error("No user ID found in session"));
      }

      const user = await prisma.user.findUnique({
        where: { id: userId }, // Just pass the string ID
        include: {
          roles: {
            include: {
              role: true,
            },
          },
        },
      });

      done(null, user);
    } catch (error) {
      done(error);
    }
  });
};

// Helper functions
async function generateUniqueUsername(baseUsername) {
  let counter = 1;
  let candidate = baseUsername;

  while (true) {
    const existingUser = await prisma.user.findUnique({
      where: { username: candidate },
    });

    if (!existingUser) return candidate;

    candidate = `${baseUsername}${counter}`;
    counter++;

    if (counter > 100) {
      throw new Error("Username generation failed");
    }
  }
}

async function createAuditLog(userId, actionType, ipAddress, userAgent) {
  await prisma.auditLog.create({
    data: {
      actionType,
      entityType: "USER",
      entityId: userId,
      userId,
      ipAddress,
      userAgent,
    },
  });
}
