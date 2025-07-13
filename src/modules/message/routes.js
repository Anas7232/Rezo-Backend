import express from 'express';
import { messageController } from './controller.js';
import { authenticateUser } from '../../middlewares/authentication.js';

const router = express.Router();

// Apply authentication middleware to all routes
router.use(authenticateUser());

// GET /conversations - Get user conversations
router.get('/', messageController.getUserConversations);

// POST /messages - Create new message
router.post('/:id/messages', messageController.createMessage);

// GET /messages - Get conversation messages
router.get('/:id/messages', messageController.getMessages);

export default router;