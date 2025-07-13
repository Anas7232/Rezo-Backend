import express from 'express';
import controller from './controller.js';
import { authenticateUser, authorizeAccess } from '../../middlewares/authentication.js';

const router = express.Router();

// User routes
router.post('/', authenticateUser(), controller.create);
router.get('/me', authenticateUser(), controller.getMyRequest);

// Admin routes
router.get('/', authenticateUser({ roles: ['admin'] }), controller.list);
router.post('/:id/approve', authenticateUser({ roles: ['admin'] }), controller.approve);
router.post('/:id/reject', authenticateUser({ roles: ['admin'] }), controller.reject);

export default router; 