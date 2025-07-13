// prisma/seed.js
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { v4 as uuidv4 } from "uuid";

const prisma = new PrismaClient();

async function main() {
  try {
    console.log("🧹 Clearing all data...");
    // Delete referencing tables first (in correct order)
    await prisma.casbinRule.deleteMany();
    await prisma.userRole.deleteMany();
    await prisma.rolePermission.deleteMany();
    await prisma.oTPVerification.deleteMany();
    await prisma.passwordReset.deleteMany();
    await prisma.twoFactorAuth.deleteMany();
    await prisma.session.deleteMany();
    await prisma.profile.deleteMany();
    await prisma.auditLog.deleteMany();
    await prisma.property.deleteMany();
    await prisma.booking.deleteMany();
    await prisma.payment.deleteMany();
    await prisma.review.deleteMany();
    await prisma.conversationParticipant.deleteMany();
    await prisma.messageMetadata.deleteMany();
    await prisma.ownershipRequest.deleteMany();
    // Now delete users, roles, permissions
    await prisma.user.deleteMany();
    await prisma.permission.deleteMany();
    await prisma.role.deleteMany();
    
    console.log("✅ Database cleared");

    // Create roles
    console.log("👥 Creating roles...");
    const userRole = await prisma.role.create({
      data: {
        id: uuidv4(),
        name: "user",
        description: "Default user role",
        isSystem: false,
        isDefault: true,
      },
    });

    const adminRole = await prisma.role.create({
      data: {
        id: uuidv4(),
        name: "admin",
        description: "Admin role",
        isSystem: true,
        isDefault: false,
      },
    });

    console.log("✅ Roles created");

    // Create permissions
    console.log("🔐 Creating permissions...");
    const userPermission = await prisma.permission.create({
      data: {
        id: uuidv4(),
        resource: "user",
        action: "read",
        description: "User read permission",
      },
    });

    const adminPermission = await prisma.permission.create({
      data: {
        id: uuidv4(),
        resource: "admin",
        action: "manage",
        description: "Admin manage permission",
      },
    });

    console.log("✅ Permissions created");

    // Create users
    console.log("👤 Creating users...");
    const superAdminUser = await prisma.user.create({
      data: {
        id: uuidv4(),
        email: "superadmin@corent.com",
        passwordHash: await bcrypt.hash("Super@Admin123", 12),
        isActive: true,
        isVerified: true,
        profile: {
          create: {
            id: uuidv4(),
            firstName: "System",
            lastName: "Admin",
            gender: "MALE",
          },
        },
      },
    });

    const adminUser = await prisma.user.create({
      data: {
        id: uuidv4(),
        email: "admin@test.com",
        passwordHash: await bcrypt.hash("password123", 12),
        isActive: true,
        isVerified: true,
        profile: {
          create: {
            id: uuidv4(),
            firstName: "Admin",
            lastName: "User",
            gender: "MALE",
          },
        },
      },
    });

    console.log("✅ Users created");

    // Assign permissions to roles
    console.log("🔗 Assigning permissions...");
    await prisma.rolePermission.create({
      data: {
        roleId: userRole.id,
        permissionId: userPermission.id,
        conditions: {},
      },
    });

    await prisma.rolePermission.create({
      data: {
        roleId: adminRole.id,
        permissionId: adminPermission.id,
        conditions: {},
      },
    });

    console.log("✅ Permissions assigned");

    // Assign roles to users
    console.log("👥 Assigning roles to users...");
    await prisma.userRole.create({
      data: {
        userId: superAdminUser.id,
        roleId: adminRole.id,
        assignedBy: superAdminUser.id,
      },
    });
    await prisma.userRole.create({
      data: {
        userId: adminUser.id,
        roleId: adminRole.id,
        assignedBy: superAdminUser.id,
      },
    });

    console.log("✅ Roles assigned");

    console.log("🎉 Database seeded successfully!");
    console.log(`- Default role: ${userRole.name} (isDefault: ${userRole.isDefault})`);
    
  } catch (error) {
    console.error("❌ Seeding failed:", error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

main(); 