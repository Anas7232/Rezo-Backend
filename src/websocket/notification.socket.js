// src/websocket/notification.socket.js
import Notification from '../models/Notification.js';
import redis from '../config/redis.js';
import logger from '../config/logger.js';
import { NotificationEvents } from './events.js';

/**
 * Initializes notification WebSocket handlers
 * @param {Socket} socket - The socket instance
 * @param {Server} io - The Socket.IO server instance
 * @param {Map} connectedUsers - Map of connected users (userId -> socketId)
 */
export function initNotificationSocket(socket, io, connectedUsers) {
  const userId = socket.user?.id;

  // Subscribe to user's notification channel
  const subscribeToNotifications = async () => {
    try {
      const subscriber = redis.duplicate();
      // await subscriber.connect();
      
      // Subscribe to user's personal notification channel
      await subscriber.subscribe(`user:${userId}:notifications`, (message) => {
        socket.emit(NotificationEvents.NEW_NOTIFICATION, JSON.parse(message));
      });

      // Subscribe to global notification channel if needed
      await subscriber.subscribe('notifications:global', (message) => {
        socket.emit(NotificationEvents.GLOBAL_NOTIFICATION, JSON.parse(message));
      });

      // Clean up on disconnect
      socket.on('disconnect', () => {
        subscriber.unsubscribe();
        subscriber.quit().catch(err => 
          logger.error('Error closing Redis subscriber:', err)
        );
      });

    } catch (error) {
      logger.error('Error setting up notification subscriptions:', error);
    }
  };

  // Handle sending notifications
  socket.on(NotificationEvents.SEND_NOTIFICATION, async (data) => {
    try {
      await handleSendNotification(data, io, connectedUsers);
    } catch (error) {
      logger.error('Error sending notification:', error);
      socket.emit(NotificationEvents.NOTIFICATION_ERROR, {
        error: 'Failed to send notification'
      });
    }
  });

  // Handle notification read status updates
  socket.on(NotificationEvents.MARK_AS_READ, async (notificationIds) => {
    try {
      await handleMarkAsRead(userId, notificationIds, io);
    } catch (error) {
      logger.error('Error marking notifications as read:', error);
    }
  });

  // Initialize subscriptions
  subscribeToNotifications();
}

// ========== Core Notification Handlers ==========

/**
 * Handles sending a notification to a user
 */
async function handleSendNotification(data, io, connectedUsers) {
  const { toUserId, type, content, metadata = {} } = data;
  
  // 1. Save to database (both PostgreSQL and MongoDB)
  const notification = await createNotificationRecord(toUserId, type, content, metadata);
  
  // 2. Check if recipient is online
  const isRecipientOnline = connectedUsers.has(toUserId);
  
  // 3. Deliver notification
  if (isRecipientOnline) {
    // Real-time delivery via WebSocket
    io.to(connectedUsers.get(toUserId)).emit(
      NotificationEvents.NEW_NOTIFICATION,
      notification
    );
  }
  
  // 4. Publish to Redis for cross-instance delivery and offline storage
  await redis.publish(
    `user:${toUserId}:notifications`,
    JSON.stringify({
      event: NotificationEvents.NEW_NOTIFICATION,
      payload: notification
    })
  );
  
  // 5. Add to push notification queue if user is offline
  if (!isRecipientOnline) {
    await addToPushQueue(toUserId, notification);
  }
}

/**
 * Creates a notification record in both PostgreSQL and MongoDB
 */
async function createNotificationRecord(userId, type, content, metadata) {
  // Create in PostgreSQL (for relationships and reporting)
  const pgNotification = await prisma.notification.create({
    data: {
      user: { connect: { id: userId } },
      type,
      content: JSON.stringify(content),
      metadata: JSON.stringify(metadata),
      status: 'UNREAD'
    }
  });

  // Create in MongoDB (for flexible schema and rich content)
  const mongoNotification = new Notification({
    notificationId: pgNotification.id,
    userId,
    type,
    content,
    metadata,
    status: 'unread',
    createdAt: new Date()
  });
  await mongoNotification.save();

  return {
    ...mongoNotification.toObject(),
    id: pgNotification.id,
    createdAt: pgNotification.createdAt
  };
}

/**
 * Marks notifications as read
 */
async function handleMarkAsRead(userId, notificationIds, io) {
  // Update both databases
  await Promise.all([
    // PostgreSQL update
    prisma.notification.updateMany({
      where: { 
        id: { in: notificationIds },
        userId 
      },
      data: { status: 'READ', readAt: new Date() }
    }),
    
    // MongoDB update
    Notification.updateMany(
      { 
        notificationId: { $in: notificationIds },
        userId 
      },
      { $set: { status: 'read', readAt: new Date() } }
    )
  ]);

  // Broadcast read status to other devices
  await redis.publish(
    `user:${userId}:notifications`,
    JSON.stringify({
      event: NotificationEvents.NOTIFICATIONS_READ,
      payload: { notificationIds }
    })
  );
}

/**
 * Adds notification to push queue for offline users
 */
async function addToPushQueue(userId, notification) {
  // Check user's push notification preferences
  const preferences = await getUserNotificationPreferences(userId);
  
  if (preferences.pushEnabled) {
    await redis.lpush(
      `user:${userId}:push_queue`,
      JSON.stringify(notification)
    );
    
    // Trigger push service (implementation depends on your push provider)
    await triggerPushNotification(userId, notification);
  }
}

// ========== Utility Functions ==========

async function getUserNotificationPreferences(userId) {
  // Implement based on your user preferences system
  return {
    pushEnabled: true,
    emailEnabled: false,
    // ... other preferences
  };
}

async function triggerPushNotification(userId, notification) {
  // Implement based on your push notification service (Firebase, APNs, etc.)
  // This would typically:
  // 1. Get user's device tokens
  // 2. Format the notification payload
  // 3. Send to push notification service
}