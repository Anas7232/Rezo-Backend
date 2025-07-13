// src/websocket/user.socket.js
import Presence from '../models/Presence.js';
import redis from '../config/redis.js';
import logger from '../config/logger.js';
import { UserEvents } from './events.js';

export const initUserSocket = (socket, io, connectedUsers) => {
  const userId = socket.user.id;

  // Track connection in memory (for single-instance tracking)
  connectedUsers.set(userId, socket);

  // Initialize presence tracking
  trackUserPresence(userId, true, socket)
    .then(() => {
      // Subscribe to user-specific channels
      subscribeToUserChannels(socket, userId);
      
      // Set up event handlers
      setupPresenceHandlers(socket, userId, io, connectedUsers);
    })
    .catch(error => {
      logger.error('Error initializing user socket:', error);
    });
};

// ========== Core Presence Functions ==========

async function trackUserPresence(userId, isOnline, socket) {
  try {
    // Update Redis tracking
    await redis.hset('online_users', userId, 'connected');
    
    // Update MongoDB presence record
    const presenceUpdate = {
      status: isOnline ? 'online' : 'offline',
      lastActive: new Date(),
      $push: {
        devices: {
          deviceId: socket.deviceId || 'web',
          platform: socket.userAgent || 'web',
          lastSeen: new Date()
        }
      }
    };

    await Presence.findOneAndUpdate(
      { userId },
      presenceUpdate,
      { upsert: true, new: true }
    );

    // Broadcast presence update
    await redis.publish('presence:updates', JSON.stringify({
      event: UserEvents.PRESENCE_UPDATE,
      payload: {
        userId,
        status: isOnline ? 'online' : 'offline',
        lastActive: new Date().toISOString()
      }
    }));

  } catch (error) {
    logger.error('Error tracking user presence:', error);
    throw error;
  }
}

// ========== Channel Subscriptions ==========

function subscribeToUserChannels(socket, userId) {
  // Create a dedicated Redis subscriber for this socket
  const subscriber = redis.duplicate();
  subscriber.subscribe(`user:${userId}:presence`, (message) => {
    socket.emit('presence_update', JSON.parse(message));
  });

  subscriber.subscribe(`user:${userId}:typing`, (message) => {
    socket.emit('typing_indicator', JSON.parse(message));
  });
  
}

// ========== Event Handlers ==========

function setupPresenceHandlers(socket, userId, io, connectedUsers) {
  // Handle disconnection
  socket.on('disconnect', async () => {
    try {
      // Remove from in-memory tracking
      connectedUsers.delete(userId);
      
      // Check if user has other active connections
      const hasOtherConnections = Array.from(connectedUsers.keys())
        .some(id => id === userId);

      if (!hasOtherConnections) {
        // Update presence status if no other connections exist
        await trackUserPresence(userId, false, socket);
        
        // Broadcast offline status
        io.emit(UserEvents.USER_OFFLINE, { 
          userId,
          timestamp: new Date().toISOString()
        });
      }

    } catch (error) {
      logger.error('Error handling disconnect:', error);
    }
  });

  // Handle manual status updates
  socket.on(UserEvents.UPDATE_STATUS, async ({ status }) => {
    try {
      const validStatuses = ['online', 'away', 'busy', 'offline'];
      if (!validStatuses.includes(status)) return;

      await Presence.findOneAndUpdate(
        { userId },
        { status, lastActive: new Date() }
      );

      // Broadcast status update
      io.emit(UserEvents.STATUS_UPDATE, {
        userId,
        status,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error('Error updating user status:', error);
    }
  });

  // Handle typing indicators
  socket.on(UserEvents.TYPING_START, ({ conversationId }) => {
    socket.to(conversationId).emit(UserEvents.TYPING_START, {
      userId,
      conversationId
    });
  });

  socket.on(UserEvents.TYPING_END, ({ conversationId }) => {
    socket.to(conversationId).emit(UserEvents.TYPING_END, {
      userId,
      conversationId
    });
  });

  // Handle active conversation changes
  socket.on(UserEvents.ACTIVE_CONVERSATION, ({ conversationId }) => {
    // Track which conversation the user is currently viewing
    redis.hset(`user:${userId}:activity`, 'activeConversation', conversationId);
  });
}

// ========== Utility Functions ==========

export async function getUserPresence(userId) {
  try {
    const presence = await Presence.findOne({ userId }) || {
      status: 'offline',
      lastActive: null
    };

    // Check Redis for real-time connection status
    const isConnected = await redis.hexists('online_users', userId);
    if (isConnected && presence.status === 'offline') {
      presence.status = 'online';
    }

    return presence;
  } catch (error) {
    logger.error('Error getting user presence:', error);
    return {
      status: 'offline',
      lastActive: null
    };
  }
}