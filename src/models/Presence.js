import mongoose, { model } from 'mongoose';
const { Schema } = mongoose;

const presenceSchema = new Schema({
  // Reference to PostgreSQL users.id
  userId: { 
    type: String, 
    required: true, 
    unique: true,
    index: true 
  },
  
  status: {
    type: String,
    enum: ['online', 'offline', 'away', 'busy'],
    default: 'offline'
  },
  
  lastActive: Date,
  
  // For multi-device support
  devices: [{
    deviceId: String,
    platform: String,
    pushToken: String,
    lastSeen: Date
  }],
  
  // For typing indicators
  typingIn: { 
    type: String, 
    default: null 
  } // conversation_id
}, {
  timestamps: true
});

// TTL index for inactive users
presenceSchema.index({ lastActive: 1 }, { 
  expireAfterSeconds: 86400 // 24h inactivity 
});

// Update presence helper
presenceSchema.methods.updatePresence = async function(newStatus) {
  this.status = newStatus;
  this.lastActive = new Date();
  return this.save();
};

const Presence = model('Presence', presenceSchema);

export default Presence;