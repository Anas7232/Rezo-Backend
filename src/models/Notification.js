// src/models/Notification.js
import mongoose from "mongoose";
const { Schema } = mongoose;

// Sub-schema for action buttons in notifications
const actionSchema = new Schema(
  {
    type: {
      type: String,
      enum: ["url", "route", "function"],
      required: true,
    },
    label: { type: String, required: true },
    value: { type: String, required: true }, // URL, route path, or function name
    metadata: Schema.Types.Mixed, // Additional data needed for the action
  },
  { _id: false }
);

// Sub-schema for notification content
const contentSchema = new Schema(
  {
    title: { type: String, required: true },
    body: String,
    image: String,
    icon: String,
    // For rich content notifications
    components: [
      {
        type: { type: String, enum: ["text", "image", "button", "divider"] },
        content: Schema.Types.Mixed,
        styles: Schema.Types.Mixed,
      },
    ],
    // For localization
    locale: {
      type: String,
      default: "en",
      index: true,
    },
  },
  { _id: false }
);

// Sub-schema for delivery tracking
const deliverySchema = new Schema(
  {
    websocket: {
      delivered: { type: Boolean, default: false },
      deliveredAt: Date,
    },
    push: {
      sent: { type: Boolean, default: false },
      sentAt: Date,
      received: { type: Boolean, default: false },
      receivedAt: Date,
    },
    email: {
      sent: { type: Boolean, default: false },
      sentAt: Date,
    },
  },
  { _id: false }
);

// Main notification schema
const notificationSchema = new Schema(
  {
    // Reference to PostgreSQL notification.id
    notificationId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    // Reference to PostgreSQL users.id
    userId: {
      type: String,
      required: true,
      index: true,
    },

    // Notification type (system, message, friend_request, etc.)
    type: {
      type: String,
      required: true,
      enum: [
        "system",
        "message",
        "friend_request",
        "mention",
        "reaction",
        "group_invite",
        "event",
        "custom",
      ],
      index: true,
    },

    // Notification content
    content: {
      type: contentSchema,
      required: true,
    },

    // Actions/buttons
    actions: [actionSchema],

    // Metadata
    metadata: {
      // Contextual data (e.g., conversationId for message notifications)
      context: Schema.Types.Mixed,
      // Priority levels: low (0), medium (1), high (2), urgent (3)
      priority: { type: Number, default: 1, min: 0, max: 3 },
      // Expiration date (for time-sensitive notifications)
      expiresAt: Date,
      // Additional custom data
      custom: Schema.Types.Mixed,
    },

    // Status tracking
    status: {
      read: { type: Boolean, default: false },
      readAt: Date,
      archived: { type: Boolean, default: false },
      archivedAt: Date,
    },

    // Delivery tracking
    delivery: {
      type: deliverySchema,
      default: () => ({}),
    },

    // System timestamps
    createdAt: { type: Date, default: Date.now, index: true },
    updatedAt: { type: Date, default: Date.now },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform: function (doc, ret) {
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
    toObject: { virtuals: true },
  }
);

// Indexes for common query patterns
notificationSchema.index({ userId: 1, status: 1 }); // User's unread notifications
notificationSchema.index({ userId: 1, type: 1 }); // Notifications by type
notificationSchema.index({
  userId: 1,
  status: 1,
  createdAt: -1,
}); // Sorted notifications
notificationSchema.index(
  {
    "metadata.expiresAt": 1,
  },
  {
    expireAfterSeconds: 0, // TTL index for auto-expiring notifications
  }
);

// Virtual for isExpired
notificationSchema.virtual("isExpired").get(function () {
  return this.metadata?.expiresAt && this.metadata.expiresAt < new Date();
});

// Middleware for updating delivery status
notificationSchema.pre("save", function (next) {
  if (this.isModified("delivery")) {
    this.updatedAt = new Date();

    // If websocket delivered but not marked, update
    if (
      this.delivery?.websocket?.delivered &&
      !this.delivery.websocket.deliveredAt
    ) {
      this.delivery.websocket.deliveredAt = new Date();
    }
  }
  next();
});

// Static methods
notificationSchema.statics.findByUser = function (userId, options = {}) {
  const {
    limit = 20,
    skip = 0,
    unreadOnly = false,
    types = [],
    sort = { createdAt: -1 },
  } = options;

  const query = { userId };

  if (unreadOnly) {
    query["status.read"] = false;
  }

  if (types.length > 0) {
    query.type = { $in: types };
  }

  return this.find(query).sort(sort).skip(skip).limit(limit).lean().exec();
};

notificationSchema.statics.markAsRead = function (
  notificationIds,
  userId = null
) {
  const update = {
    "status.read": true,
    "status.readAt": new Date(),
  };

  const query = { notificationId: { $in: notificationIds } };

  if (userId) {
    query.userId = userId;
  }

  return this.updateMany(query, update).exec();
};

notificationSchema.statics.markAsDelivered = function (
  notificationId,
  channel
) {
  const update = {
    $set: {
      [`delivery.${channel}.delivered`]: true,
      [`delivery.${channel}.deliveredAt`]: new Date(),
      updatedAt: new Date(),
    },
  };

  return this.findOneAndUpdate({ notificationId }, update, {
    new: true,
  }).exec();
};

// Instance methods
notificationSchema.methods.toNotificationPayload = function () {
  return {
    id: this.notificationId,
    type: this.type,
    content: this.content,
    actions: this.actions,
    metadata: this.metadata,
    status: this.status,
    createdAt: this.createdAt,
    isExpired: this.isExpired,
  };
};

const Notification = mongoose.model("Notification", notificationSchema);

export default Notification;
