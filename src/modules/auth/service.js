import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";
import config from "../../config/env.js";
import {
  generateAccessToken,
  generateRefreshToken,
  generateOTP,
} from "../../utils/generateToken.js";
import { sendEmail } from "../../utils/email.js";
import logger from "../../config/logger.js";
import {
  ConflictError,
  ValidationError,
  AuthError,
} from "../../utils/apiError.js";
import redis from "../../config/redis.js";

const PASSWORD_REGEX =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
const prisma = new PrismaClient();

export const registerUser = async ({ email, password }) => {
  // if (!PASSWORD_REGEX.test(password)) {
  //   throw new ValidationError("Password must contain 8+ chars with uppercase, lowercase, number, and special character");
  // }

  const existingUser = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });
  if (existingUser) {
    logger.warn(`Registration attempt with existing email: ${email}`);
    throw new ConflictError("Email already registered");
  }

  // Hash password and OTP
  const hashedPassword = await bcrypt.hash(password, 12);
  const otp = generateOTP();
  // Create new user
  const defaultRole = await prisma.role.findFirst({
    where: { isDefault: true },
  });
  const SystemAdmin = await prisma.user.findFirst({
    where: { email: "superadmin@corent.com" },
  });

  if (!defaultRole) {
    throw new Error("Default role not found in database");
  }
  const minutesFromNow = (minutes) =>
    new Date(Date.now() + minutes * 60 * 1000);

  // Create user with OTP verification
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: hashedPassword,
      otpVerifications: {
        create: {
          type: "EMAIL_VERIFICATION",
          code: otp,
          expiresAt: minutesFromNow(15),
        },
      },
      roles: {
        create: {
          roleId: defaultRole.id,
          assignedBy: SystemAdmin.id, // Using a valid UUID
        },
      },
    },
    select: {
      id: true,
      email: true,
      createdAt: true,
      roles: { select: { role: { select: { isDefault: true } } } },
    },
  });

  // Send verification email
  await sendEmail(
    email,
    "Verify Your Email",
    `Your verification code is: ${otp}`,
    `<strong>${otp}</strong>`
  ).catch((error) => {
    logger.error(`Email send failed: ${error.message}`);
    throw new Error("Failed to send verification email");
  });

  return user;
};

export const verifyEmailService = async (code, context) => {
  // Find valid OTP verification
  const verification = await prisma.oTPVerification.findFirst({
    where: {
      code: { equals: code },
      type: "EMAIL_VERIFICATION",
      expiresAt: { gt: new Date() },
      attempts: { lt: 3 },
    },
    include: { user: true },
  });
  if (!verification) {
    await prisma.oTPVerification.updateMany({
      where: {
        code,
        type: "EMAIL_VERIFICATION",
      },
      data: {
        attempts: { increment: 1 },
      },
    });

    throw new ValidationError("Invalid or expired verification code");
  }

  // Update verification attempts
  await prisma.oTPVerification.update({
    where: { id: verification.id },
    data: { attempts: { increment: 1 } },
  });

  // Verify user email
  const user = await prisma.user.update({
    where: { id: verification.user.id },
    data: { isVerified: true },
    select: {
      id: true,
      email: true,
      isVerified: true,
      roles: { select: { role: { select: { name: true } } } },
    },
  });
  // Create session
  const [accessToken, refreshToken] = await Promise.all([
    generateAccessToken(user.id, user.roles),
    generateRefreshToken(user.id, user.roles),
  ]);

  await prisma.session.create({
    data: {
      userId: user.id,
      sessionToken: accessToken,
      refreshToken,
      expiresAt: new Date(
        Date.now() + config.get("jwtRefreshExpiration") * 1000
      ),
      deviceInfo: context.deviceInfo,
      ipAddress: context.ipAddress,
    },
  });

  // Cleanup OTP
  await prisma.oTPVerification.deleteMany({
    where: { userId: user.id, type: "EMAIL_VERIFICATION" },
  });

  return { accessToken, refreshToken, user };
};

export const loginUser = async (email, password, context) => {
  const rateLimitKey = `rate_limit:login:${email}`;

  // Get current attempts (returns null if key doesn't exist)
  const currentAttempts = await redis.get(rateLimitKey);
  const attempts = currentAttempts ? parseInt(currentAttempts, 10) : 0;

  if (attempts >= config.get("login.maxAttempts")) {
    const ttl = await redis.ttl(rateLimitKey);
    if (ttl < 0) {
      // Ensure banTime is a valid positive integer
      const banTime = parseInt(config.get("login.banTime"), 10);
      if (isNaN(banTime) || banTime <= 0) {
        throw new Error("Invalid banTime configuration");
      }
      await redis.expire(rateLimitKey, banTime);
    }
    throw new AuthError("Too many attempts. Try again later.");
  }

  // Increment attempts
  await redis.incr(rateLimitKey);
  if (attempts === 0) {
    const banTime = parseInt(config.get("login.banTime"), 10);
    await redis.expire(rateLimitKey, banTime);
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      passwordHash: true,
      isActive: true,
      isVerified: true,
      mfaEnabled: true,
      roles: { select: { role: { select: { name: true } } } },
    },
  });
  if (!user) {
    logger.warn(`Login attempt for non-existent user: ${email}`);
    throw new AuthError("Invalid credentials");
  }

  if (!user.isActive) throw new AuthError("Account deactivated");
  if (!user.isVerified) throw new AuthError("Account not verified");

  const passwordValid = await bcrypt.compare(password, user.passwordHash);
  if (!passwordValid) {
    logger.warn(`Invalid password attempt for: ${email}`);
    throw new AuthError("Invalid credentials");
  }

  // Handle MFA if enabled
  if (user.mfaEnabled) {
    const otp = await bcrypt.hash(generateOTP(), 6);
    await prisma.otpVerification.create({
      data: {
        userId: user.id,
        type: "LOGIN_2FA",
        code: otp,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      },
    });

    await sendEmail(email, "2FA Login Code", `Your code is: ${otp}`);
    return { mfaRequired: true };
  }

  // Create new session
  const defultRole = user.roles[0].role.name
  const [accessToken, refreshToken] = await Promise.all([
    generateAccessToken(user.id, user.roles),
    generateRefreshToken(user.id),
  ]);

  const newSession = await prisma.session.create({
    data: {
      userId: user.id,
      sessionToken: accessToken,
      refreshToken,
      expiresAt: new Date(
        Date.now() + config.get("jwtRefreshExpiration") * 1000
      ),
      deviceInfo: context.deviceInfo,
      ipAddress: context.ipAddress,
    },
    select: { id: true },
  });
  const sessionKey = `session:${newSession.id}`;

  const sessionData = {
    userId: user.id,
    email,
    sessionToken: accessToken,
    refreshToken,
    ipAddress: context.ipAddress,
    deviceInfo: context.deviceInfo,
  };

  const sessionExpirySeconds = parseInt(config.get("jwtRefreshExpiration"), 10);
  if (isNaN(sessionExpirySeconds) || sessionExpirySeconds <= 0) {
    throw new Error("Invalid session expiration configuration");
  }

  // const sessionKey = `session:${newSession.id}`;
  await redis.setex(
    sessionKey,
    sessionExpirySeconds,
    JSON.stringify(sessionData)
  );

  // 3. Refresh token storage with integer validation
  const refreshExpiry = parseInt(config.get("jwtRefreshExpiration"), 10);
  await redis.setex(`refresh:${refreshToken}`, refreshExpiry, sessionKey);
  // console.log(user.roles.map((role) => role.role.name));
  return {
    accessToken,
    refreshToken,
    sessionId: newSession.id,
    user: await prisma.user.findUnique({
      where: { id: user.id },
      select: {
        id: true,
        email: true,
        isVerified: true,
       
      },
    }),
    roles: user.roles.map((role) => role.role.name),
    defaultRole: defultRole,
  };
};

export const refreshToken = async (token, context) => {
  let decoded;
  try {
    decoded = jwt.verify(token, config.get("refreshSecret"), {
      algorithms: ["HS256"],
      issuer: config.get("jwtIssuer"),
      audience: config.get("jwtAudience"),
    });
  } catch (error) {
    logger.error(`JWT verification failed: ${error.message}`);
    throw new AuthError("Invalid or expired refresh token");
  }

  const session = await prisma.session.findFirst({
    where: { userId: decoded.sub, refreshToken: token },
    include: { user: true },
  });

  if (!session || session.user.id !== decoded.sub) {
    throw new AuthError("Invalid refresh token");
  }

  // Rotate tokens
  // ✅ Rotate tokens securely
  const newAccessToken = generateAccessToken(
    session.user.id,
    session.user.roles
  );
  const newRefreshToken = generateRefreshToken(
    session.user.id,
    session.user.roles
  );

  await prisma.session.update({
    where: { id: session.id },
    data: {
      sessionToken: newAccessToken,
      refreshToken: newRefreshToken,
      expiresAt: new Date(
        Date.now() + config.get("jwtRefreshExpiration") * 1000
      ),
      ipAddress: context.ipAddress,
      deviceInfo: context.deviceInfo,
    },
  });

  return { accessToken: newAccessToken, refreshToken: newRefreshToken };
};

export const logoutUser = async (userId, sessionId) => {
  // Delete session from Redis
  await redis.del(`session:${sessionId}`);
  // await redis.del(`refresh:${refreshToken}`);

  // // Optional: Add to blacklist if using JWT
  // await redis.setex(
  //   `blacklist:${refreshToken}`,
  //   config.get("jwtRefreshExpiration"),
  //   "logged_out"
  // );
  await prisma.session.deleteMany({
    where: { userId, id: sessionId },
  });
};

export const requestPasswordResetService = async (email) => {
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });

  if (!user) {
    logger.info(`Password reset request for unknown email: ${email}`);
    return { message: "If account exists, reset instructions sent" };
  }

  const existingOTP = await prisma.oTPVerification.findFirst({
    where: {
      userId: user.id,
      type: "PASSWORD_RESET",
    },
  });

  const otp = generateOTP();

  if (existingOTP) {
    await prisma.oTPVerification.update({
      where: { id: existingOTP.id },
      data: {
        code: otp,
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
        attempts: 0,
      },
    });
  } else {
    await prisma.oTPVerification.create({
      data: {
        userId: user.id,
        type: "PASSWORD_RESET",
        code: otp,
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      },
    });
  }

  try {
    await sendEmail(
      email,
      "Password Reset Code",
      `Your reset code is: ${otp}`,
      `<strong>${otp}</strong>`
    );
  } catch (error) {
    logger.error(`Failed to send password reset email: ${error.message}`);
    throw new Error("Failed to send password reset email");
  }

  return { message: "If account exists, reset instructions sent" };
};

export const resetPasswordService = async (code, newPassword, context) => {
  // if (!PASSWORD_REGEX.test(newPassword)) {
  //   throw new ValidationError("Password must meet complexity requirements");
  // }

  const verification = await prisma.oTPVerification.findFirst({
    where: {
      code: { equals: code },
      type: "PASSWORD_RESET",
      expiresAt: { gt: new Date() },
      attempts: { lt: 3 },
    },
    include: { user: true },
  });

  if (!verification) {
    throw new ValidationError("Invalid or expired reset code");
  }

  const hashedPassword = await bcrypt.hash(newPassword, 12);

  await Promise.all([
    prisma.user.update({
      where: { id: verification.user.id },
      data: { passwordHash: hashedPassword },
    }),
    prisma.oTPVerification.deleteMany({
      where: { userId: verification.user.id, type: "PASSWORD_RESET" },
    }),
    prisma.session.deleteMany({
      where: { userId: verification.user.id },
    }),
  ]);

  await sendEmail(
    verification.user.email,
    "Password Changed",
    `Password changed from ${context.ipAddress}`,
    `<p>Changed from IP: ${context.ipAddress}</p>`
  );

  return { success: true };
};
