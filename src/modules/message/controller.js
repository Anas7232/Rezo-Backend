import { MessageService } from './service.js';
import { getIO } from '../../websocket/index.js';

export const messageController = {
  /**
   * Get user conversations
   */
  async getUserConversations(req, res) {
    try {
      const userId = req.user.userId;
      const conversations = await MessageService.getUserConversations(userId);

      res.json({
        status: 'success',
        data: conversations
      });
    } catch (error) {
      console.error('Failed to fetch conversations:', error);
      res.status(500).json({
        status: 'error',
        message: 'Failed to retrieve conversations'
      });
    }
  },

  /**
   * Handle message creation
   */
  async createMessage(req, res) {
    try {
      const { id: conversationId } = req.params;
      const { content, attachments = [], clientMessageId } = req.body;
      const senderId = req.user.userId;

      // Validate input
      if (!content && (!attachments || attachments.length === 0)) {
        return res.status(400).json({
          status: 'error',
          message: 'Message must have content or attachments'
        });
      }

      // Create message
      const message = await MessageService.createMessage({
        conversationId,
        senderId,
        content,
        attachments,
        clientMessageId
      });

      // Broadcast via WebSocket
      getIO().to(`conv_${conversationId}`).emit('new_message', {
        event: 'new_message',
        data: message,
        conversationId,
        senderId
      });

      res.status(201).json({
        status: 'success',
        data: message
      });

    } catch (error) {
      console.error('Message creation failed:', error);
      
      const status = error.message.includes('Not a participant') ? 403 : 500;
      res.status(status).json({
        status: 'error',
        message: error.message || 'Failed to create message'
      });
    }
  },

  /**
   * Get conversation messages
   */
  async getMessages(req, res) {
    try {
      const { id: conversationId } = req.params;
      const { limit = 50, before } = req.query;
      const userId = req.user.userId;

      // Verify participation
      const isParticipant = await MessageService.verifyParticipant(conversationId, userId);
      if (!isParticipant) {
        return res.status(403).json({
          status: 'error',
          message: 'Not a participant in this conversation'
        });
      }

      // Get messages
      const messages = await MessageService.getMessages({
        conversationId,
        limit: parseInt(limit),
        before
      });

      res.json({
        status: 'success',
        data: messages,
        pagination: {
          limit: parseInt(limit),
          before,
          nextCursor: messages.length > 0 
            ? messages[messages.length - 1].createdAt.toISOString() 
            : null
        }
      });

    } catch (error) {
      console.error('Failed to fetch messages:', error);
      res.status(500).json({
        status: 'error',
        message: 'Failed to retrieve messages'
      });
    }
  }
};