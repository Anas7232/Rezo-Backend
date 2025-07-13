import prisma from "../config/database.js";
import redis from "../config/redis.js";
import logger from "../config/logger.js";
import Message from "../models/Message.js";
import ConversationCache from "../models/ConversationCache.js";
import { ChatEvents } from "./events.js";

export const handleChatEvents = (ws, userId) => {
  ws.on("message", async (rawData) => {
    try {
      const data = JSON.parse(rawData);
      if (!data.event || !data.payload) {
        throw new Error("Invalid message format");
      }
      // Add debug logging
      // logger.debug(`Received chat event: ${data.event}`, {
      //   userId,
      //   payload: data.payload,
      // });
      const { event, payload } = JSON.parse(rawData);
      switch (event) {
        case ChatEvents.SEND_MESSAGE:
          console.log("Executing SEND_MESSAGE handler");
          await handleSendMessage(userId, payload);
          break;

        case ChatEvents.MESSAGE_DELIVERED:
          await handleMessageDelivered(userId, payload);
          break;

        case ChatEvents.MESSAGE_READ:
          await handleMessageRead(userId, payload);
          break;

        case ChatEvents.MESSAGE_REACTION:
          await handleMessageReaction(userId, payload);
          break;

        case ChatEvents.EDIT_MESSAGE:
          await handleEditMessage(userId, payload);
          break;

        case ChatEvents.DELETE_MESSAGE:
          await handleDeleteMessage(userId, payload);
          break;

        case ChatEvents.TYPING_INDICATOR:
          await handleTypingIndicator(userId, payload);
          break;

        case ChatEvents.JOIN_CONVERSATION:
          await handleJoinConversation(userId, payload);
          break;

        case ChatEvents.LEAVE_CONVERSATION:
          await handleLeaveConversation(userId, payload);
          break;
      }
    } catch (error) {
      logger.error("Chat socket error:", error);
      ws.send(
        JSON.stringify({
          event: ChatEvents.MESSAGE_ERROR,
          payload: { error: error.message },
        })
      );
    }
  });
};

async function handleSendMessage(
  senderId,
  { conversationId, content, attachments = [], receiverId }
) {
  // Validate input
  if (!content?.text && attachments.length === 0) {
    throw new Error("Invalid message content");
  }

  console.log("<============> \n Take Message ", content, "\n<============>");

  const prismaTx = prisma;

  try {
    const sender = await prismaTx.user.findUnique({ where: { id: senderId } });
    const receiver = await prismaTx.user.findUnique({
      where: { id: receiverId },
    });
    if (!sender) {
      throw new Error("Sender does not exist");
    }
    if (!receiver) {
      throw new Error("Reciver not Found");
    }
    // 🔹 If no conversationId provided, create one
    if (!conversationId) {
      const newConversation = await prismaTx.conversation.create({
        data: {
          participants: {
            create: [{ userId: senderId }],
          },
        },
      });
      conversationId = newConversation.id;
      console.log(
        "\n \n 🔹 New conversation created:",
        conversationId,
        "\n \n"
      );
    }

    // 🔄 Begin transactional logic
    const transaction = await prismaTx.$transaction(async (tx) => {
      // 1. Save metadata in PostgreSQL
      const pgMessage = await tx.messageMetadata.create({
        data: {
          conversation: { connect: { id: conversationId } },
          sender: { connect: { id: senderId } },
          receiver: { connect: { id: receiverId } },
          status: "SENT",
          sentAt: new Date(),
        },
      });

      logger.debug("PostgreSQL message created", { pgMessage });

      // 2. Save content in MongoDB
      const mongoMessage = new Message({
        messageId: pgMessage.id,
        conversationId,
        senderId,
        receiverId,
        content,
        attachments,
        status: "sent",
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const savedMongoMsg = await mongoMessage.save();
      // logger.debug("MongoDB message saved", { savedMongoMsg });
      // 2.1 Update PostgreSQL messageMetadata with MongoDB _id
      await tx.messageMetadata.update({
        where: { id: pgMessage.id },
        data: { mongoId: savedMongoMsg._id },
      });
      // 3. Update conversation cache
      await ConversationCache.findOneAndUpdate(
        { conversationId },
        {
          $set: {
            updatedAt: new Date(),
            lastMessage: {
              messageId: pgMessage.id,
              senderId,
              content:
                content.text || (attachments.length > 0 ? "[Attachment]" : ""),
              timestamp: new Date(),
            },
          },
        },
        { upsert: true, new: true }
      );
      console.log("End Result", {
        ...savedMongoMsg.toObject(),
        pgId: pgMessage.id,
        pgCreatedAt: pgMessage.sentAt,
        pgUpdatedAt: pgMessage.sentAt,
      });
      return {
        ...savedMongoMsg.toObject(),
        pgId: pgMessage.id,
        pgCreatedAt: pgMessage.sentAt,
        pgUpdatedAt: pgMessage.sentAt,
      };
    });

    // 4. Publish message to chat channel
    await redis.publish(
      `chat:${conversationId}`,
      JSON.stringify({
        event: ChatEvents.NEW_MESSAGE,
        payload: transaction,
      })
    );

    // 5. Notify other participants
    const participants = await prisma.conversationParticipant.findMany({
      where: { conversationId },
      select: { userId: true },
    });

    const notificationPromises = participants
      .filter(({ userId }) => userId !== senderId)
      .map(({ userId }) =>
        redis.publish(
          `user:${userId}:notifications`,
          JSON.stringify({
            event: "NEW_CHAT_MESSAGE",
            payload: {
              conversationId,
              messageId: transaction.pgId,
              senderId,
              preview:
                transaction.content?.text?.substring(0, 100) || "[Attachment]",
              timestamp: new Date().toISOString(),
            },
          })
        )
      );

    await Promise.all(notificationPromises);
  } catch (error) {
    logger.error("Message creation failed:", {
      error: error.message,
      stack: error.stack,
      senderId,
      conversationId,
    });
    throw error;
  }
}

async function handleMessageDelivered(userId, { messageIds }) {
  try {
    // 1. Validate message IDs are proper UUIDs
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const invalidIds = messageIds.filter((id) => !uuidRegex.test(id));

    if (invalidIds.length > 0) {
      throw new Error(
        `Invalid message IDs: ${invalidIds.join(", ")}. Expected UUID format.`
      );
    }

    // 2. Update both databases with transaction safety
    const [pgResult, mongoResult] = await Promise.all([
      // PostgreSQL update
      prisma.messageMetadata.updateMany({
        where: {
          id: { in: messageIds },
          status: "SENT",
        },
        data: {
          status: "DELIVERED",
          deliveries: {
            updateMany: {
              where: { userId },
              data: { status: "DELIVERED", receivedAt: new Date() },
            },
          },
        },
      }),

      // MongoDB update
      Message.updateMany(
        {
          messageId: { $in: messageIds },
          status: "sent",
        },
        {
          $set: {
            status: "delivered",
            "deliveries.$[elem].status": "delivered",
            "deliveries.$[elem].receivedAt": new Date(),
          },
        },
        {
          arrayFilters: [{ "elem.userId": userId }],
        }
      ),
    ]);

    // 3. Verify updates were successful
    if (pgResult.count === 0 || mongoResult.modifiedCount === 0) {
      throw new Error(
        "No messages were updated. Check if message IDs exist and status is 'SENT'."
      );
    }

    // 4. Notify senders
    const messages = await Message.find({
      messageId: { $in: messageIds },
    }).select("senderId conversationId");

    const uniqueSenders = [...new Set(messages.map((m) => m.senderId))];

    await Promise.all(
      uniqueSenders.map((senderId) =>
        redis.publish(
          `user:${senderId}:messages`,
          JSON.stringify({
            event: ChatEvents.MESSAGES_DELIVERED,
            payload: {
              messageIds,
              confirmedBy: userId,
              conversationId: messages.find((m) => m.senderId === senderId)
                ?.conversationId,
            },
          })
        )
      )
    );

    logger.info(
      `Delivered status updated for messages: ${messageIds.join(", ")}`
    );
    return {
      success: true,
      pgCount: pgResult.count,
      mongoCount: mongoResult.modifiedCount,
    };
  } catch (error) {
    logger.error("Failed to update delivery status", {
      error: error.message,
      messageIds,
      userId,
      stack: error.stack,
    });
    throw error;
  }
}

async function handleTypingIndicator(userId, { conversationId, isTyping }) {
  // Update presence record
  await Presence.findOneAndUpdate(
    { userId },
    { typingIn: isTyping ? conversationId : null }
  );

  // Broadcast to conversation participants
  await redis.publish(
    `chat:${conversationId}`,
    JSON.stringify({
      event: ChatEvents.TYPING_INDICATOR,
      payload: { userId, isTyping },
    })
  );
}

async function handleMessageRead(userId, { messageIds }) {
  // Update both databases
  await Promise.all([
    prisma.message.updateMany({
      where: { id: { in: messageIds } },
      data: { status: "read" },
    }),
    Message.updateMany(
      { messageId: { $in: messageIds } },
      { $set: { status: "read" } }
    ),
  ]);

  // Notify sender about read receipt
  const messages = await Message.find({ messageId: { $in: messageIds } });
  const uniqueSenders = [...new Set(messages.map((m) => m.senderId))];

  await Promise.all(
    uniqueSenders.map((senderId) =>
      redis.publish(
        `chat:${senderId}`,
        JSON.stringify({
          event: "MESSAGES_READ",
          payload: { messageIds, readBy: userId },
        })
      )
    )
  );
}

async function handleMessageReaction(userId, { messageId, emoji }) {
  const reaction = {
    userId,
    emoji,
    createdAt: new Date(),
  };

  const updatedMessage = await Message.findOneAndUpdate(
    { messageId },
    { $push: { reactions: reaction } },
    { new: true }
  );

  await redis.publish(
    `chat:${updatedMessage.conversationId}`,
    JSON.stringify({
      event: "MESSAGE_REACTION",
      payload: {
        messageId,
        reaction,
      },
    })
  );
}

async function handleEditMessage(userId, { messageId, newContent }) {
  const updatedMessage = await Message.findOneAndUpdate(
    { messageId, senderId: userId },
    {
      $set: { "content.text": newContent },
      $push: {
        edits: {
          content: newContent,
          editedAt: new Date(),
        },
      },
    },
    { new: true }
  );

  if (updatedMessage) {
    await redis.publish(
      `chat:${updatedMessage.conversationId}`,
      JSON.stringify({
        event: "MESSAGE_EDITED",
        payload: {
          messageId,
          newContent,
          editedAt: updatedMessage.edits.slice(-1)[0].editedAt,
        },
      })
    );
  }
}

async function handleDeleteMessage(userId, { messageId }) {
  const updatedMessage = await Message.findOneAndUpdate(
    { messageId },
    {
      $set: {
        "deleted.isDeleted": true,
        "deleted.deletedAt": new Date(),
        "deleted.deletedBy": userId,
      },
    },
    { new: true }
  );

  if (updatedMessage) {
    await redis.publish(
      `chat:${updatedMessage.conversationId}`,
      JSON.stringify({
        event: "MESSAGE_DELETED",
        payload: { messageId, deletedBy: userId },
      })
    );
  }
}
