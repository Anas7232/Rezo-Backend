// src/middleware/audit.js
import { Prisma } from '@prisma/client';
import { logger } from '../config/logger.js';
import { getClientIp } from '@supercharge/request-ip';
import { nanoid } from 'nanoid';
import { inspect } from 'util';

class AuditLogger {
  constructor(prisma) {
    this.prisma = prisma;
    this.queue = [];
    this.batchSize = 25;
    this.flushInterval = 5000;
    this.isFlushing = false;
    this.startBatchProcessor();
  }

  async logEvent(event) {
    try {
      this.queue.push({
        ...event,
        id: nanoid(),
        timestamp: new Date()
      });

      if (this.queue.length >= this.batchSize) {
        await this.flush();
      }
    } catch (error) {
      logger.error('Audit log queueing failed', { error });
    }
  }

  async flush() {
    if (this.isFlushing || this.queue.length === 0) return;
    this.isFlushing = true;

    const batch = this.queue.splice(0, this.batchSize);
    try {
      await this.prisma.$transaction(async (tx) => {
        for (const event of batch) {
          await tx.auditLog.create({
            data: {
              id: event.id,
              action: event.action,
              entityType: event.entityType,
              entityId: event.entityId,
              details: this.sanitizeDetails(event.details),
              userId: event.userId,
              ipAddress: event.ipAddress,
              userAgent: event.userAgent,
              status: event.status,
              error: event.error,
              metadata: event.metadata
            }
          });
        }
      });
      logger.debug(`Flushed ${batch.length} audit events`);
    } catch (error) {
      logger.error('Audit log flush failed', { error });
      this.queue.unshift(...batch);
    } finally {
      this.isFlushing = false;
    }
  }

  startBatchProcessor() {
    setInterval(() => this.flush(), this.flushInterval).unref();
  }

  sanitizeDetails(details) {
    try {
      return typeof details === 'string' 
        ? details 
        : JSON.parse(JSON.stringify(details, (key, value) => {
            if (key.toLowerCase().includes('password') || key === 'token') {
              return '*****';
            }
            return value;
          }));
    } catch (error) {
      return `Sanitization failed: ${error.message}`;
    }
  }

  middleware() {
    return async (req, res, next) => {
      const startTime = Date.now();
      const requestId = req.headers['x-request-id'] || nanoid();
      
      res.on('finish', async () => {
        try {
          const duration = Date.now() - startTime;
          const event = {
            action: req.method,
            entityType: req.baseUrl.replace('/', ''),
            entityId: req.params.id,
            userId: req.user?.id,
            ipAddress: getClientIp(req),
            userAgent: req.headers['user-agent'],
            status: res.statusCode,
            metadata: {
              requestId,
              duration,
              path: req.path,
              params: req.params,
              query: req.query
            }
          };

          if (res.statusCode >= 400) {
            event.error = {
              message: res.errorMessage,
              code: res.errorCode,
              stack: process.env.NODE_ENV === 'production' ? undefined : res.errorStack
            };
          }

          await this.logEvent(event);
        } catch (error) {
          logger.error('Audit middleware failed', { error });
        }
      });

      next();
    };
  }
}

// Singleton instance setup
let auditInstance = null;

export const initializeAudit = (prisma) => {
  if (!auditInstance) {
    auditInstance = new AuditLogger(prisma);
  }
  return auditInstance;
};

export const auditContext = {
  log: async (params) => {
    if (!auditInstance) {
      throw new Error('Audit logger not initialized');
    }
    await auditInstance.logEvent({
      ...params,
      status: 'manual',
      metadata: {
        ...params.metadata,
        source: 'manual'
      }
    });
  }
};

export default (prisma) => auditInstance ?? initializeAudit(prisma);