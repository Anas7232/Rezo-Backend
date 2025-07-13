import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

export default {
  // Create a new ownership request (user)
  async createOwnershipRequest({ userId, email, profile }) {
    return prisma.ownershipRequest.create({
      data: { userId, email, profile },
    });
  },

  // Get ownership request by userId
  async getOwnershipRequestByUser(userId) {
    return prisma.ownershipRequest.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  },

  // List all ownership requests (admin)
  async listOwnershipRequests(status) {
    return prisma.ownershipRequest.findMany({
      where: status ? { status } : {},
      orderBy: { createdAt: 'desc' },
      include: { user: true },
    });
  },

  // Approve ownership request (admin)
  async approveOwnershipRequest(id) {
    return prisma.ownershipRequest.update({
      where: { id },
      data: { status: 'APPROVED', approvedAt: new Date() },
    });
  },

  // Reject ownership request (admin)
  async rejectOwnershipRequest(id) {
    return prisma.ownershipRequest.update({
      where: { id },
      data: { status: 'REJECTED', rejectedAt: new Date() },
    });
  },
}; 