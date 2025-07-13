import { Server } from "socket.io";
import { verifyToken } from "../utils/generateToken.js";
import Presence from "../models/Presence.js";
import ConversationCache from "../models/ConversationCache.js";
import prisma from "../config/database.js";
import mongoose from "mongoose";
import Message from "../models/Message.js";
import config from "../config/env.js";

// Default allowed origins (development)
const DEFAULT_ALLOWED_ORIGINS = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
];

// Map to track user connections
const userSockets = new Map(); // userId -> Set(socketIds)
const conversationRooms = new Map(); // conversationId -> Set(userIds)

export function initializeSocket(server) {
  const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(",")
    : DEFAULT_ALLOWED_ORIGINS;

  const io = new Server(server, {
    cors: {
      origin: allowedOrigins,
      methods: ["GET", "POST"],
      credentials: true,
    },
    transports: ["websocket", "polling"],
    pingInterval: 25000,
    pingTimeout: 20000,
  });

  // Authentication middleware
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      if (!token) throw new Error("Authentication required");

      const decoded = verifyToken(token, config.get("jwtSecret"));
      socket.userId = decoded.sub;
      next();
    } catch (error) {
      console.error("Socket auth failed:", error.message);
      next(new Error("Authentication failed"));
    }
  });

  // Setup real-time updates based on environment
  if (process.env.NODE_ENV === "production") {
    setupChangeStreams(io).catch((error) => {
      console.error("Change stream setup failed, falling back to polling:", error);
      setupPolling(io);
    });
  } else {
    console.warn("Using polling fallback for real-time updates in development");
    setupPolling(io);
  }

  io.on("connection", (socket) => {
    const { userId } = socket;

    // Track user connections
    if (!userSockets.has(userId)) {
      userSockets.set(userId, new Set());
    }
    userSockets.get(userId).add(socket.id);

    // Update presence status
    updateUserPresence(io, userId, "online");

    // Join conversation rooms
    socket.on("join_conversations", async (conversationIds) => {
      if (!Array.isArray(conversationIds)) return;

      for (const conversationId of conversationIds) {
        socket.join(`conv_${conversationId}`);

        // Track conversation membership
        if (!conversationRooms.has(conversationId)) {
          conversationRooms.set(conversationId, new Set());
        }
        conversationRooms.get(conversationId).add(userId);
      }
    });

    // Message events
    socket.on("send_message", async (messageData, callback) => {
      try {
        // Validate conversation membership
        const isParticipant = await prisma.conversationParticipant.findUnique({
          where: {
            conversationId_userId: {
              conversationId: messageData.conversationId,
              userId,
            },
          },
        });

        if (!isParticipant) {
          throw new Error("Not in conversation");
        }

        // Create message in databases
        const message = await createMessage(userId, messageData);

        // Broadcast to conversation room
        io.to(`conv_${messageData.conversationId}`)
          .except(socket.id)
          .emit("chat:new_message", { conversationId: messageData.conversationId, message });

        // Update last message in cache
        await ConversationCache.updateLastMessage(
          messageData.conversationId,
          message
        );

        callback({ status: "success", message });
      } catch (error) {
        console.error("Message send error:", error);
        callback({ status: "error", message: error.message });
      }
    });

    // Typing indicators
    socket.on("typing", async (conversationId) => {
      try {
        await Presence.updateOne(
          { userId },
          { $set: { typingIn: conversationId } }
        );

        socket.to(`conv_${conversationId}`).emit("user:typing", {
          userId,
          conversationId,
        });

        // Clear typing after 3s
        setTimeout(async () => {
          try {
            await Presence.updateOne(
              { userId, typingIn: conversationId },
              { $set: { typingIn: null } }
            );

            socket.to(`conv_${conversationId}`).emit("user:stopped_typing", {
              userId,
              conversationId,
            });
          } catch (error) {
            console.error("Error clearing typing indicator:", error);
          }
        }, 3000);
      } catch (error) {
        console.error("Typing indicator error:", error);
      }
    });

    // Message read receipts
    socket.on("mark_read", async (conversationId, messageId) => {
      try {
        await prisma.$transaction([
          prisma.messageMetadata.updateMany({
            where: {
              conversationId,
              senderId: { not: userId },
              status: { in: ["SENT", "DELIVERED"] },
            },
            data: { status: "READ" },
          }),
          prisma.conversationParticipant.update({
            where: {
              conversationId_userId: {
                conversationId,
                userId,
              },
            },
            data: {
              lastReadAt: new Date(),
            },
          }),
        ]);

        io.to(`conv_${conversationId}`).emit("chat:message_read", {
          userId,
          conversationId,
          messageIds: [messageId],
        });
      } catch (error) {
        console.error("Read receipt error:", error);
      }
    });

    // Disconnection handler
    socket.on("disconnect", () => {
      // Remove socket from user tracking
      if (userSockets.has(userId)) {
        const sockets = userSockets.get(userId);
        sockets.delete(socket.id);

        if (sockets.size === 0) {
          userSockets.delete(userId);
          updateUserPresence(io, userId, "offline");
        }
      }

      // Remove from conversation rooms
      for (const [conversationId, users] of conversationRooms) {
        if (users.has(userId)) {
          users.delete(userId);
          if (users.size === 0) {
            conversationRooms.delete(conversationId);
          }
        }
      }
    });
  });

  return io;
}

async function updateUserPresence(io, userId, status) {
  try {
    await Presence.findOneAndUpdate(
      { userId },
      {
        $set: {
          status,
          lastActive: new Date(),
          ...(status === "offline" && { typingIn: null }),
        },
      },
      { upsert: true, new: true }
    );

    // Notify affected conversations
    const conversations = await prisma.conversationParticipant.findMany({
      where: { userId },
      select: { conversationId: true },
    });

    for (const { conversationId } of conversations) {
      io.to(`conv_${conversationId}`).emit("presence_update", {
        userId,
        status,
        lastActive: new Date(),
      });
    }
  } catch (error) {
    console.error("Presence update error:", error);
  }
}

/**
 * Production: MongoDB Change Streams
 */
async function setupChangeStreams(io) {
  try {
    // Verify replica set status
    const adminDb = mongoose.connection.db.admin();
    const status = await adminDb.command({ replSetGetStatus: 1 });
    if (!status.ok) throw new Error("Not a replica set");

    // Message change stream
    const messageChangeStream = Message.watch([], {
      fullDocument: "updateLookup",
      maxAwaitTimeMS: 5000,
    });

    messageChangeStream.on("change", (change) => {
      try {
        if (change.operationType === "insert") {
          const message = change.fullDocument;
          io.to(`conv_${message.conversationId}`).emit("new_message", message);
        } else if (change.operationType === "update") {
          if (change.updateDescription.updatedFields.status) {
            io.to(`conv_${change.documentKey.conversationId}`).emit(
              "message_status",
              {
                messageId: change.documentKey._id,
                status: change.updateDescription.updatedFields.status,
              }
            );
          }
        }
      } catch (error) {
        console.error("Message change processing error:", error);
      }
    });

    // Presence change stream
    const presenceChangeStream = Presence.watch([], {
      fullDocument: "updateLookup",
      maxAwaitTimeMS: 5000,
    });

    presenceChangeStream.on("change", (change) => {
      try {
        if (change.operationType === "update") {
          const presence = change.fullDocument;

          if (presence.typingIn) {
            io.to(`conv_${presence.typingIn}`).emit("user_typing", {
              userId: presence.userId,
              conversationId: presence.typingIn,
            });
          }

          if (change.updateDescription.updatedFields.status) {
            io.emit("presence_update", {
              userId: presence.userId,
              status: presence.status,
              lastActive: presence.lastActive,
            });
          }
        }
      } catch (error) {
        console.error("Presence change processing error:", error);
      }
    });

    // Error handlers
    messageChangeStream.on("error", (err) => {
      console.error("Message stream error:", err);
      setupPolling(io); // Fallback to polling
    });

    presenceChangeStream.on("error", (err) => {
      console.error("Presence stream error:", err);
    });

    // Cleanup on server shutdown
    io.on("close", () => {
      messageChangeStream.close();
      presenceChangeStream.close();
    });

    console.log("Change streams initialized successfully");
  } catch (error) {
    throw error; // Propagate error to fallback to polling
  }
}

/**
 * Development: Polling Fallback
 */
function setupPolling(io) {
  let messageInterval, presenceInterval;
  const POLL_INTERVAL = 2000; // 2 seconds

  // Clean up existing intervals
  const cleanup = () => {
    clearInterval(messageInterval);
    clearInterval(presenceInterval);
  };

  // Message polling
  messageInterval = setInterval(async () => {
    try {
      const lastMinute = new Date(Date.now() - 60000);
      const newMessages = await Message.find({
        createdAt: { $gte: lastMinute },
      })
        .sort({ createdAt: -1 })
        .limit(50);

      newMessages.forEach((msg) => {
        io.to(`conv_${msg.conversationId}`).emit("new_message", msg);
      });
    } catch (error) {
      console.error("Message polling error:", error);
    }
  }, POLL_INTERVAL);

  // Presence polling
  presenceInterval = setInterval(async () => {
    try {
      const activeUsers = await Presence.find({
        lastActive: { $gte: new Date(Date.now() - 30000) }, // 30 seconds
        typingIn: { $exists: true },
      });

      activeUsers.forEach((user) => {
        if (user.typingIn) {
          io.to(`conv_${user.typingIn}`).emit("user_typing", {
            userId: user.userId,
            conversationId: user.typingIn,
          });
        }
      });
    } catch (error) {
      console.error("Presence polling error:", error);
    }
  }, POLL_INTERVAL);

  // Clean up on server shutdown
  io.on("close", cleanup);
  console.log("Polling fallback initialized");
}

// Helper function to create coordinated message
async function createMessage(senderId, messageData) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // 1. Create MongoDB message
    const message = new Message({
      messageId: messageData.id || new mongoose.Types.ObjectId().toString(),
      conversationId: messageData.conversationId,
      senderId,
      content: messageData.content,
      attachments: messageData.attachments || [],
      status: "sent",
    });

    const savedMessage = await message.save({ session });

    // 2. Create PostgreSQL metadata
    const metadata = await prisma.messageMetadata.create({
      data: {
        id: savedMessage.messageId,
        conversationId: savedMessage.conversationId,
        senderId,
        mongoId: savedMessage._id.toString(),
      },
    });

    // 3. Update conversation last message
    await prisma.conversation.update({
      where: { id: messageData.conversationId },
      data: { lastMessageAt: new Date() },
    });

    await session.commitTransaction();

    return {
      ...savedMessage.toObject(),
      postgresMetadata: metadata,
    };
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
}