// middleware/guestMiddleware.js
import { AuthError } from '../utils/apiError.js';
import jwt from 'jsonwebtoken';
import config from '../config/env.js';
import prisma from '../config/database.js';

export const guestMiddleware = () => {
  return async (req, res, next) => {
    try {
      // Allow verification and login routes even if token is present
      if (
        req.originalUrl.includes('/api/auth/verify-email') ||
        req.originalUrl.includes('/api/auth/login')
      ) {
        return next();
      }
      // 1. Check for access token in common locations
      const token =
        req.cookies?.accessToken ||
        req.header('Authorization')?.replace('Bearer ', '') ||
        req.query.accessToken;

      // 2. If no token found, proceed to route
      if (!token) return next();

      // 3. Verify token validity
      let decoded;
      try {
        decoded = jwt.verify(token, config.get('jwtSecret'), {
          issuer: config.get('jwtIssuer'),
          audience: config.get('jwtAudience'),
        });
      } catch (jwtError) {
        // Invalid token - treat as guest
        return next();
      }

      // 4. Check if user still exists
      const user = await prisma.user.findUnique({
        where: { id: decoded.sub },
        select: { id: true, isActive: true }
      });

      // 5. If valid user exists, deny access
      if (user?.isActive) {
        throw new AuthError('Authenticated users cannot access this route');
      }

      next();
    } catch (error) {
      // Handle different response types
      
      res.status(error.statusCode || 401).json({
        success: false,
        code: 'AUTHENTICATED_ACCESS',
        message: error.message || 'Already authenticated',
        redirectUrl: '/'
      });
    }
  };
};