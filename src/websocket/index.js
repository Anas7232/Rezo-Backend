// src/websocket/index.js
import { WebSocketServer } from "ws";
import { initUserSocket } from "./user.socket.js";
import { handleChatEvents } from "./chat.socket.js";
import { initNotificationSocket } from "./notification.socket.js";
import logger from "../config/logger.js";
import redis from "../config/redis.js";
import Presence from "../models/Presence.js";
import { UserEvents } from "./events.js";
import session from "express-session";
import sessionConfig, { sessionStore } from "../config/session.js";
import { parse } from "url";
// import { parse as parseCookie } from "cookie";
import { verifyToken } from "../utils/generateToken.js";
import http from "http";
import config from "../config/env.js";
const connectedUsers = new Map();

let wss;

export const setupWebSocket = (server) => {
  wss = new WebSocketServer({
    noServer: true,
    perMessageDeflate: {
      zlibDeflateOptions: {
        chunkSize: 1024,
        memLevel: 7,
        level: 3,
      },
      clientNoContextTakeover: true,
    },
  });

  // Use the same session store from config
  const wsSessionMiddleware = session({
    ...sessionConfig,
    store: sessionStore,
    saveUninitialized: false,
    rolling: false,
  });

  server.on("upgrade", async (request, socket, head) => {
    try {
      const { pathname } = parse(request.url);
      if (pathname !== "/ws") {
        socket.destroy();
        return;
      }
      // Get the session cookie
      const token = request.headers["authorization"]?.split(" ")[1];
      // let sessionId = cookies["connect.sid"];

      if (!token) {
        logger.debug("No session token found");
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }
      let user;
      try {
        user = verifyToken(token, config.get("jwtSecret"));
      } catch (error) {
        logger.debug("Invalid token:", error);
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }
      const userId = user.sub;
      // Extract session ID from signed cookie format
      // if (sessionId.startsWith("s:")) {
      //   sessionId = sessionId.substring(2, sessionId.indexOf("."));
      // }

      // Verify we have a valid session ID format
      // if (!/^[a-fA-F0-9]{24}$/.test(sessionId)) {
      //   logger.debug(`Invalid session ID format: ${sessionId}`);
      //   socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      //   socket.destroy();
      //   return;
      // }

      // Get session from Redis using the correct key pattern
      // Note: This should match your express-session Redis store configuration
      // const sessionKey = `session:${sessionId}`; // Common default pattern
      // const sessionData = await redis.get(sessionKey);

      // if (!sessionData) {
      //   logger.debug(`Session not found in Redis for key: ${sessionKey}`);
      //   socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      //   socket.destroy();
      //   return;
      // }

      // // Parse the session data
      // let parsedSession;
      // try {
      //   parsedSession = JSON.parse(sessionData);
      // } catch (err) {
      //   logger.error("Failed to parse session data:", err);
      //   socket.write("HTTP/1.1 500 Internal Server Error\r\n\r\n");
      //   socket.destroy();
      //   return;
      // }

      // // Verify user exists in session
      // if (!parsedSession.userId) {
      //   logger.debug("Session found but no userId in session data");
      //   socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      //   socket.destroy();
      //   return;
      // }

      // // Create fake request/response for session middleware
      // const fakeReq = new http.IncomingMessage(socket);
      // Object.assign(fakeReq, {
      //   url: request.url,
      //   headers: request.headers,
      //   connection: socket,
      //   sessionID: sessionId,
      //   sessionStore: sessionStore,
      // });

      // const fakeRes = new http.ServerResponse(fakeReq);

      // // Create session instance
      // await new Promise((resolve, reject) => {
      //   wsSessionMiddleware(fakeReq, fakeRes, (err) => {
      //     if (err) reject(err);
      //     else resolve();
      //   });
      // });
      // if (!fakeReq.session || !parsedSession.userId) {
      //   socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      //   socket.destroy();
      //   return;
      // }

      // Proceed with upgrade
      wss.handleUpgrade(request, socket, head, (ws) => {
        ws.user = userId;
        // ws.session = fakeReq.session;
        wss.emit("connection", ws, request);
      });
    } catch (error) {
      logger.error("WebSocket upgrade error:", error);
      socket.write("HTTP/1.1 500 Internal Server Error\r\n\r\n");
      socket.destroy();
    }
  });

  wss.on("connection", async (ws, req) => {
    try {
      // Extract user ID from session
      const userId = ws.user;
      console.log("WebSocket Userid  ", userId);

      if (!userId) {
        ws.close(1008, "Unauthorized");
        return;
      }

      logger.info(`New WebSocket connection from user ${userId}`);

      // Store connection in memory and Redis
      connectedUsers.set(userId, ws);
      await redis.hset("ws_connections", userId, "connected");

      // Add user context to the WebSocket
      ws.userId = userId;
      ws.deviceId = req.headers["device-id"];
      ws.userAgent = req.headers["user-agent"];

      // Update presence status
      await updateUserPresence(userId, "online", ws);

      // Initialize all socket handlers
      initUserSocket(ws, wss, connectedUsers);
      handleChatEvents(ws, userId);
      initNotificationSocket(ws, wss, connectedUsers);

      // Setup heartbeat
      setupHeartbeat(ws);

      // Handle disconnection
      ws.on("close", async () => {
        await handleDisconnection(userId);
      });
    } catch (error) {
      logger.error("WebSocket connection error:", error);
      ws.close(1011, "Internal Error");
    }
  });

  return wss;
};

// ========== Core Functions ==========

async function updateUserPresence(userId, status, ws) {
  try {
    const presenceData = {
      status,
      lastActive: new Date(),
      $push: {
        devices: {
          deviceId: ws.deviceId,
          platform: ws.userAgent,
          lastSeen: new Date(),
        },
      },
    };

    // Update MongoDB presence record
    await Presence.findOneAndUpdate({ userId }, presenceData, {
      upsert: true,
      new: true,
    });

    // Broadcast presence update
    await redis.publish(
      `presence:updates`,
      JSON.stringify({
        event: UserEvents.PRESENCE_UPDATE,
        payload: {
          userId,
          status,
          lastActive: new Date().toISOString(),
          deviceId: ws.deviceId,
        },
      })
    );

    // Update all connected devices of this user
    broadcastToUserDevices(userId, {
      event: UserEvents.PRESENCE_UPDATE,
      payload: { userId, status },
    });
  } catch (error) {
    logger.error("Error updating user presence:", error);
  }
}

function setupHeartbeat(ws) {
  let isAlive = true;
  const heartbeatInterval = setInterval(() => {
    if (!isAlive) {
      logger.warn(`Terminating inactive connection for user ${ws.userId}`);
      ws.terminate();
      return;
    }
    isAlive = false;
    ws.ping();
  }, 30000); // 30 seconds

  ws.on("pong", () => {
    isAlive = true;
  });

  ws.on("close", () => {
    clearInterval(heartbeatInterval);
  });
}

async function handleDisconnection(userId) {
  try {
    // Remove from memory tracking
    connectedUsers.delete(userId);

    // Check if user has other active connections
    const hasOtherConnections = Array.from(connectedUsers.keys()).some(
      (id) => id === userId
    );

    if (!hasOtherConnections) {
      // Update presence status if no other connections exist
      await redis.hdel("ws_connections", userId);
      await Presence.findOneAndUpdate(
        { userId },
        { status: "offline", lastActive: new Date() }
      );

      // Broadcast offline status
      await redis.publish(
        `presence:updates`,
        JSON.stringify({
          event: UserEvents.PRESENCE_UPDATE,
          payload: { userId, status: "offline" },
        })
      );
    }

    logger.info(`User ${userId} disconnected`);
  } catch (error) {
    logger.error("Disconnection handling error:", error);
  }
}

// ========== Utility Functions ==========

function broadcastToUserDevices(userId, message) {
  connectedUsers.forEach((ws, id) => {
    if (id === userId) {
      try {
        ws.send(JSON.stringify(message));
      } catch (error) {
        logger.error(`Error sending to user ${userId} device:`, error);
      }
    }
  });
}

export const getIO = () => wss;

export const getConnectedUsers = () => connectedUsers;
