import prisma from "../../config/database.js";
import Message from "../../models/Message.js";
import ConversationCache from "../../models/ConversationCache.js";
import mongoose from "mongoose";

export class MessageService {
  /**
   * Get user conversations with last message and participant info
   * @param {string} userId
   * @returns {Promise<Array>} List of conversations
   */
  static async getUserConversations(userId) {
    try {
      // Get user's conversations from PostgreSQL
      const userConversations = await prisma.conversation.findMany({
        where: {
          participants: {
            some: {
              userId: userId
            }
          }
        },
        include: {
          participants: {
            include: {
              user: {
                include: {
                  profile: true
                }
              }
            }
          }
        },
        orderBy: {
          lastMessageAt: 'desc'
        }
      });

      // Get cached conversation data
      const conversationIds = userConversations.map(conv => conv.id);
      const cachedConversations = await ConversationCache.find({
        conversationId: { $in: conversationIds }
      }).lean();

      // Merge PostgreSQL and MongoDB data
      const conversations = userConversations.map(conv => {
        const cached = cachedConversations.find(c => c.conversationId === conv.id);
        const currentUserParticipant = conv.participants.find(p => p.userId === userId);
        
        return {
          id: conv.id,
          title: conv.title,
          avatar: conv.avatar,
          participants: conv.participants.map(p => ({
            userId: p.user.id,
            name: `${p.user.profile?.firstName || ''} ${p.user.profile?.lastName || ''}`.trim() || p.user.email,
            email: p.user.email,
            avatarUrl: p.user.profile?.avatarUrl,
            joinedAt: p.joinedAt,
            lastRead: p.lastRead,
            unreadCount: cached?.participants?.find(cp => cp.userId === p.user.id)?.unreadCount || 0
          })),
          lastMessage: cached?.lastMessage || null,
          createdAt: conv.createdAt,
          updatedAt: conv.updatedAt || cached?.updatedAt || conv.lastMessageAt,
          unreadCount: currentUserParticipant ? 
            (cached?.participants?.find(cp => cp.userId === userId)?.unreadCount || 0) : 0
        };
      });

      return conversations;
    } catch (error) {
      console.error('Error fetching user conversations:', error);
      throw error;
    }
  }

  /**
   * Create a new message with transaction support
   * @param {Object} params
   * @param {string} params.conversationId
   * @param {string} params.senderId
   * @param {Object} params.content
   * @param {Array} [params.attachments]
   * @param {string} [params.clientMessageId]
   * @returns {Promise<Object>} Created message
   */
  static async createMessage({
    conversationId,
    senderId,
    content,
    attachments = [],
    clientMessageId,
  }) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // Generate message ID if not provided
      const messageId =
        clientMessageId || new mongoose.Types.ObjectId().toString();

      // 1. Create MongoDB message document
      const mongoMessage = await this._createMongoMessage({
        messageId,
        conversationId,
        senderId,
        content,
        attachments,
        session,
      });

      // 2. Create PostgreSQL metadata
      const postgresMessage = await this._createPostgresMetadata({
        messageId,
        conversationId,
        senderId,
        mongoId: mongoMessage._id.toString(),
        sentAt: mongoMessage.createdAt,
        session,
      });

      // 3. Update conversation last message
      await this._updateConversationMetadata({
        conversationId,
        lastMessageAt: mongoMessage.createdAt,
        session,
      });

      // 4. Update conversation cache
      await this._updateConversationCache({
        conversationId,
        message: mongoMessage,
        senderId,
        session,
      });

      await session.commitTransaction();

      return {
        ...mongoMessage.toObject(),
        postgresMetadata: postgresMessage,
      };
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Get messages for a conversation with pagination
   * @param {Object} params
   * @param {string} params.conversationId
   * @param {number} [params.limit=50]
   * @param {string} [params.before] - ISO date string for cursor pagination
   * @returns {Promise<Array>} List of messages
   */
  static async getMessages({ conversationId, limit = 50, before }) {
    const query = { conversationId };
    if (before) query.createdAt = { $lt: new Date(before) };

    return Message.find(query)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .lean();
  }

  /**
   * Verify if user is a conversation participant
   * @param {string} conversationId
   * @param {string} userId
   * @returns {Promise<boolean>}
   */
  static async verifyParticipant(conversationId, userId) {
    const participant = await prisma.conversationParticipant.findUnique({
      where: {
        conversationId_userId: {
          conversationId,
          userId,
        },
      },
    });
    return !!participant;
  }

  // Private helper methods

  static async _createMongoMessage({
    messageId,
    conversationId,
    senderId,
    content,
    attachments,
    session,
  }) {
    const message = new Message({
      messageId,
      conversationId,
      senderId,
      content: this._formatContent(content),
      attachments: this._processAttachments(attachments),
      status: "sent",
    });
    return message.save({ session });
  }

  static async _createPostgresMetadata({
    messageId,
    conversationId,
    senderId,
    mongoId,
    sentAt,
    session,
  }) {
    return prisma.messageMetadata.create({
      data: {
        id: messageId,
        conversationId,
        senderId,
        mongoId,
        sentAt,
      },
    });
  }

  static async _updateConversationMetadata({
    conversationId,
    lastMessageAt,
    session,
  }) {
    return prisma.conversation.update({
      where: { id: conversationId },
      data: { lastMessageAt },
    });
  }

  static async _updateConversationCache({
    conversationId,
    message,
    senderId,
    session,
  }) {
    return ConversationCache.findOneAndUpdate(
      { conversationId },
      {
        $set: {
          lastMessage: {
            messageId: message.messageId,
            senderId: message.senderId,
            content: message.content.text || "[Attachment]",
            sentAt: message.createdAt,
            status: message.status,
          },
          updatedAt: new Date(),
        },
        $inc: {
          "participants.$[elem].unreadCount": 1,
        },
      },
      {
        arrayFilters: [{ "elem.userId": { $ne: senderId } }],
        upsert: true,
        session,
      }
    );
  }

  static _formatContent(content) {
    if (typeof content === "string") {
      return {
        text: content.trim(),
        formattedText: [
          {
            type: "text",
            content: content.trim(),
            indices: [0, content.length - 1],
          },
        ],
      };
    }

    return {
      text: content.text?.trim() || "",
      formattedText:
        content.formattedText?.map((item) => ({
          type: item.type || "text",
          content: item.content?.trim() || "",
          indices: item.indices || [0, 0],
        })) || [],
    };
  }

  static _processAttachments(attachments) {
    if (!attachments || !Array.isArray(attachments)) return [];

    return attachments.map((attachment) => ({
      type: ["image", "video", "file", "audio"].includes(attachment.type)
        ? attachment.type
        : "file",
      url: attachment.url,
      filename: attachment.filename || `file-${Date.now()}`,
      size: attachment.size || 0,
      ...(attachment.type === "image" || attachment.type === "video"
        ? {
            width: attachment.width,
            height: attachment.height,
          }
        : {}),
      ...(attachment.type === "video" || attachment.type === "audio"
        ? {
            duration: attachment.duration,
          }
        : {}),
      thumbnail: attachment.thumbnail,
    }));
  }
}
