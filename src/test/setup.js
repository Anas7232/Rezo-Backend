import  prisma  from '../config/database.js';
import redis from "../config/redis.js";

beforeEach(async () => {
  await prisma.$transaction([
    prisma.session.deleteMany(),
    prisma.oTPVerification.deleteMany(),
    prisma.user.deleteMany(),
  ]);
});

afterAll(async () => {
  await prisma.$disconnect();
  await redis.quit(); 
});