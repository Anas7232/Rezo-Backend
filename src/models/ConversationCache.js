import mongoose, { model } from 'mongoose';
const { Schema } = mongoose;

const participantSchema = new Schema({
  userId: { type: String, required: true }, // PostgreSQL user_id
  joinedAt: { type: Date, default: Date.now },
  lastRead: Date,
  unreadCount: { type: Number, default: 0 }
}, { _id: false });

const conversationSchema = new Schema({
  // Reference to PostgreSQL conversations.id
  conversationId: { 
    type: String, 
    required: true, 
    unique: true,
    index: true 
  },
  
  participants: [participantSchema],
  
  // Denormalized for performance
  lastMessage: {
    messageId: String,
    senderId: String,
    content: String,
    sentAt: Date,
    status: String
  },
  
  // For group chats
  title: String,
  avatar: String,
  admins: [String], // user_ids
  
  // System metadata
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
}, {
  timestamps: true,
  // Optimize for read performance
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes
conversationSchema.index({ 'participants.userId': 1 }); // User's conversations
conversationSchema.index({ 
  'participants.userId': 1, 
  'lastMessage.sentAt': -1 
}); // Sorted conversations

// Virtual for unread counts
conversationSchema.virtual('unreadMessages').get(function() {
  return this.participants.reduce((sum, p) => sum + (p.unreadCount || 0), 0);
});

// Update last message helper
conversationSchema.methods.updateLastMessage = async function(message) {
  this.lastMessage = {
    messageId: message.messageId,
    senderId: message.senderId,
    content: message.content.text || '[Attachment]',
    sentAt: message.createdAt,
    status: message.status
  };
  
  // Increment unread counts for all participants except sender
  this.participants.forEach(p => {
    if (p.userId !== message.senderId) {
      p.unreadCount = (p.unreadCount || 0) + 1;
    }
  });
  
  return this.save();
};

// Static method for updating last message by conversation ID
conversationSchema.statics.updateLastMessage = async function(conversationId, message) {
  const conversation = await this.findOne({ conversationId });
  
  if (!conversation) {
    // Create new cache entry if it doesn't exist
    const newConversation = new this({
      conversationId,
      lastMessage: {
        messageId: message.messageId,
        senderId: message.senderId,
        content: message.content?.text || '[Attachment]',
        sentAt: message.createdAt,
        status: message.status
      }
    });
    return newConversation.save();
  }
  
  return conversation.updateLastMessage(message);
};

const ConversationCache = model('ConversationCache', conversationSchema);

export default ConversationCache;