import service from './service.js';

export default {
  // User: Create ownership request
  async create(req, res) {
    const { email, profile } = req.body;
    const userId = req.user.id;
    // Only one pending request per user
    const existing = await service.getOwnershipRequestByUser(userId);
    if (existing && existing.status === 'PENDING') {
      return res.status(400).json({ error: 'Request already pending' });
    }
    const request = await service.createOwnershipRequest({ userId, email, profile });
    res.json(request);
  },

  // User: Get own request
  async getMyRequest(req, res) {
    const userId = req.user.id;
    const request = await service.getOwnershipRequestByUser(userId);
    res.json(request);
  },

  // Admin: List all requests
  async list(req, res) {
    const { status } = req.query;
    const requests = await service.listOwnershipRequests(status);
    res.json(requests);
  },

  // Admin: Approve
  async approve(req, res) {
    const { id } = req.params;
    const request = await service.approveOwnershipRequest(id);
    res.json(request);
  },

  // Admin: Reject
  async reject(req, res) {
    const { id } = req.params;
    const request = await service.rejectOwnershipRequest(id);
    res.json(request);
  },
}; 