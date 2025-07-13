// src/websocket/events.js

/**
 * User Presence and Status Events
 */
export const UserEvents = {
    // Client -> Server
    UPDATE_STATUS: 'user:update_status',           // When user updates their status
    TYPING_START: 'user:typing_start',             // When user starts typing
    TYPING_END: 'user:typing_end',                 // When user stops typing
    ACTIVE_CONVERSATION: 'user:active_conversation', // When user focuses a conversation
    REQUEST_PRESENCE: 'user:request_presence',     // Request presence data for users
    
    // Server -> Client
    PRESENCE_UPDATE: 'user:presence_update',       // When a user's presence changes
    STATUS_UPDATE: 'user:status_update',           // When a user's status changes
    USER_ONLINE: 'user:online',                    // When user comes online
    USER_OFFLINE: 'user:offline',                  // When user goes offline
    TYPING_INDICATOR: 'user:typing',               // When someone is typing
    PRESENCE_DATA: 'user:presence_data',           // Response to presence request
    PRESENCE_ERROR: 'user:presence_error'          // Presence request error
  };
  
  /**
   * Chat Message Events
   */
  export const ChatEvents = {
    // Client -> Server
    SEND_MESSAGE: 'chat:send_message',             // Send a new message
    MESSAGE_DELIVERED: 'chat:message_delivered',   // Confirm message delivery
    MESSAGE_READ: 'chat:message_read',             // Mark messages as read
    MESSAGE_REACTION: 'chat:message_reaction',     // Add/remove reaction
    EDIT_MESSAGE: 'chat:edit_message',             // Edit existing message
    DELETE_MESSAGE: 'chat:delete_message',         // Delete a message
    REQUEST_MESSAGES: 'chat:request_messages',     // Request message history
    REQUEST_CONVERSATIONS: 'chat:request_conversations', // Request conversation list
    
    // Server -> Client
    NEW_MESSAGE: 'chat:new_message',               // New incoming message
    MESSAGES_DELIVERED: 'chat:messages_delivered', // Delivery confirmation
    MESSAGES_READ: 'chat:messages_read',           // Read receipts
    MESSAGE_REACTION_ADDED: 'chat:reaction_added', // Reaction notification
    MESSAGE_EDITED: 'chat:message_edited',         // Message edit notification
    MESSAGE_DELETED: 'chat:message_deleted',       // Message deletion notification
    MESSAGE_HISTORY: 'chat:message_history',       // Response to message request
    CONVERSATION_LIST: 'chat:conversation_list',   // Response to conversation request
    CHAT_ERROR: 'chat:error'                       // Chat-related errors
  };
  
  /**
   * Notification Events
   */
  export const NotificationEvents = {
    // Client -> Server
    SEND_NOTIFICATION: 'notification:send',        // Send a notification
    MARK_AS_READ: 'notification:mark_read',        // Mark notifications as read
    REQUEST_NOTIFICATIONS: 'notification:request', // Request notification history
    UPDATE_PREFERENCES: 'notification:preferences', // Update notification settings
    
    // Server -> Client
    NEW_NOTIFICATION: 'notification:new',          // New incoming notification
    NOTIFICATIONS_READ: 'notification:read',       // Read confirmation
    NOTIFICATION_HISTORY: 'notification:history',  // Notification history response
    NOTIFICATION_PREFERENCES: 'notification:preferences', // Current preferences
    NOTIFICATION_ERROR: 'notification:error'       // Notification errors
  };
  
  /**
   * System and Connection Events
   */
  export const SystemEvents = {
    // Client -> Server
    AUTHENTICATE: 'system:authenticate',           // Initial authentication
    PING: 'system:ping',                           // Keep-alive ping
    SUBSCRIBE: 'system:subscribe',                 // Subscribe to channels
    UNSUBSCRIBE: 'system:unsubscribe',             // Unsubscribe from channels
    
    // Server -> Client
    AUTH_SUCCESS: 'system:auth_success',           // Authentication successful
    AUTH_FAILED: 'system:auth_failed',             // Authentication failed
    PONG: 'system:pong',                           // Keep-alive pong
    SUBSCRIPTION_SUCCESS: 'system:subscription_success', // Channel subscription
    SUBSCRIPTION_ERROR: 'system:subscription_error', // Subscription error
    CONNECTION_ERROR: 'system:connection_error',   // Connection problems
    RATE_LIMIT_WARNING: 'system:rate_limit'        // Rate limit warning
  };
  
  /**
   * Group and Room Events
   */
  export const GroupEvents = {
    // Client -> Server
    JOIN_GROUP: 'group:join',                      // Join a group/room
    LEAVE_GROUP: 'group:leave',                    // Leave a group/room
    GROUP_MESSAGE: 'group:message',                // Send group message
    UPDATE_GROUP: 'group:update',                  // Update group info
    GROUP_INVITE: 'group:invite',                  // Invite to group
    
    // Server -> Client
    GROUP_UPDATE: 'group:update',                  // Group info updated
    GROUP_MESSAGE: 'group:message',                // New group message
    GROUP_JOINED: 'group:joined',                  // Successfully joined group
    GROUP_LEFT: 'group:left',                      // Successfully left group
    GROUP_INVITE_RECEIVED: 'group:invite_received', // Received group invite
    GROUP_ERROR: 'group:error'                     // Group-related errors
  };
  
  /**
   * Media and Calling Events
   */
  export const MediaEvents = {
    // Client -> Server
    CALL_INITIATE: 'media:call_initiate',          // Start a call
    CALL_ACCEPT: 'media:call_accept',              // Accept a call
    CALL_REJECT: 'media:call_reject',              // Reject a call
    CALL_END: 'media:call_end',                    // End a call
    ICE_CANDIDATE: 'media:ice_candidate',          // WebRTC ICE candidate
    SDP_OFFER: 'media:sdp_offer',                  // WebRTC SDP offer
    SDP_ANSWER: 'media:sdp_answer',                // WebRTC SDP answer
    
    // Server -> Client
    CALL_INCOMING: 'media:call_incoming',          // Incoming call notification
    CALL_ACCEPTED: 'media:call_accepted',          // Call accepted
    CALL_REJECTED: 'media:call_rejected',          // Call rejected
    CALL_ENDED: 'media:call_ended',                // Call ended
    ICE_CANDIDATE_RECEIVED: 'media:ice_candidate_received', // ICE candidate
    SDP_OFFER_RECEIVED: 'media:sdp_offer_received', // SDP offer received
    SDP_ANSWER_RECEIVED: 'media:sdp_answer_received', // SDP answer received
    MEDIA_ERROR: 'media:error'                     // Media-related errors
  };
  
  // Combine all events for easy importing
  export const AllEvents = {
    ...UserEvents,
    ...ChatEvents,
    ...NotificationEvents,
    ...SystemEvents,
    ...GroupEvents,
    ...MediaEvents
  };
  
  /**
   * Helper function to validate event types
   */
  export function isValidEvent(event) {
    return Object.values(AllEvents).includes(event);
  }
  
  /**
   * Helper function to get event category
   */
  export function getEventCategory(event) {
    if (event.startsWith('user:')) return 'user';
    if (event.startsWith('chat:')) return 'chat';
    if (event.startsWith('notification:')) return 'notification';
    if (event.startsWith('system:')) return 'system';
    if (event.startsWith('group:')) return 'group';
    if (event.startsWith('media:')) return 'media';
    return 'unknown';
  }