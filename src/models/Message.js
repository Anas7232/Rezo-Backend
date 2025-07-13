import mongoose, { model } from "mongoose";
const { Schema } = mongoose;

const attachmentSchema = new Schema(
  {
    type: {
      type: String,
      enum: ["image", "video", "file", "audio"],
      required: true,
    },
    url: { type: String, required: true },
    filename: String,
    size: Number,
    width: Number, // For media files
    height: Number, // For media files
    duration: Number, // For audio/video
    thumbnail: String, // For media previews
  },
  { _id: false }
);

const reactionSchema = new Schema(
  {
    userId: { type: String, required: true }, // References PostgreSQL user_id
    emoji: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const messageSchema = new Schema(
  {
    // Reference to PostgreSQL message_metadata.id
    messageId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    // Reference to PostgreSQL conversations.id
    conversationId: {
      type: String,
      required: true,
      index: true,
    },

    // Reference to PostgreSQL users.id
    senderId: {
      type: String,
      required: true,
      index: true,
    },
    receiverId: {
      type: String,
      required: true,
      index: true,
    },
    content: {
      text: String,
      // Rich content support
      formattedText: [
        {
          type: { type: String, enum: ["text", "mention", "link", "emoji"] },
          content: String,
          indices: [Number], // For mentions/links position
        },
      ],
    },

    attachments: [attachmentSchema],

    status: {
      type: String,
      enum: ["sending", "sent", "delivered", "read", "failed"],
      default: "sent",
      index: true,
    },

    reactions: [reactionSchema],

    // For message edits
    edits: [
      {
        content: String,
        editedAt: { type: Date, default: Date.now },
      },
    ],

    // For deleted messages
    deleted: {
      isDeleted: { type: Boolean, default: false },
      deletedAt: Date,
      deletedBy: String, // user_id who deleted
    },

    // System metadata
    createdAt: { type: Date, default: Date.now, index: true },
    updatedAt: { type: Date, default: Date.now },
  },
  {
    timestamps: true,
    // Optimized for message retrieval patterns
    collation: { locale: "en", strength: 2 }, // Case-insensitive sorting
  }
);

// Compound indexes for common query patterns
messageSchema.index({ conversationId: 1, createdAt: -1 }); // For message history
messageSchema.index({ senderId: 1, createdAt: -1 }); // For user sent messages
messageSchema.index({
  conversationId: 1,
  status: 1,
  createdAt: -1,
}); // For delivery status checks

// Optimize for text search if needed
messageSchema.index(
  {
    "content.text": "text",
    "content.formattedText.content": "text",
  },
  {
    weights: {
      "content.text": 3,
      "content.formattedText.content": 1,
    },
    name: "message_text_search",
  }
);

// Middleware for data integrity
messageSchema.pre("save", function (next) {
  if (this.isModified("content") && this.edits) {
    this.edits.push({
      content:
        this.content.text ||
        this.content.formattedText.map((t) => t.content).join(" "),
      editedAt: new Date(),
    });
  }
  next();
});

// Static methods for common operations
messageSchema.statics.findByConversation = function (
  conversationId,
  options = {}
) {
  const { limit = 50, before } = options;

  const query = { conversationId };
  if (before) query.createdAt = { $lt: new Date(before) };

  return this.find(query).sort({ createdAt: -1 }).limit(limit).lean().exec();
};

messageSchema.statics.markAsDelivered = function (messageIds) {
  return this.updateMany(
    { messageId: { $in: messageIds } },
    { $set: { status: "delivered" } }
  ).exec();
};
messageSchema.virtual("sender", {
  ref: "UserCache",
  localField: "senderId",
  foreignField: "userId",
  justOne: true,
});

const Message = model("Message", messageSchema);

export default Message;
