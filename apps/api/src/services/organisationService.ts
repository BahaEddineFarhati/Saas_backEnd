import jwt from "jsonwebtoken";
import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/utils/AppError";
import { sendInviteEmail } from "@/services/emailService";

/**
 * Returns the organisation's details.
 */
export const getOrganisation = async (organisationId: string) => {
  const org = await prisma.organisation.findUnique({
    where: { id: organisationId },
    select: {
      id: true,
      name: true,
      slug: true,
      plan: true,
      createdAt: true,
    },
  });

  if (!org) {
    throw new AppError("Organisation not found", 404, "ORG_NOT_FOUND");
  }

  return org;
};

/**
 * Updates the organisation's name and/or slug.
 * Validates slug uniqueness across the platform.
 */
export const updateOrganisation = async (
  organisationId: string,
  data: { name?: string; slug?: string }
) => {
  // If slug is being updated, validate uniqueness
  if (data.slug) {
    // Normalize slug
    const normalizedSlug = data.slug
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, "")
      .replace(/[\s_-]+/g, "-")
      .replace(/^-+|-+$/g, "");

    if (!normalizedSlug) {
      throw new AppError("Slug cannot be empty", 400, "VALIDATION_ERROR");
    }

    const existingOrg = await prisma.organisation.findUnique({
      where: { slug: normalizedSlug },
    });

    if (existingOrg && existingOrg.id !== organisationId) {
      throw new AppError(
        "This slug is already taken by another organisation",
        409,
        "SLUG_TAKEN"
      );
    }

    data.slug = normalizedSlug;
  }

  if (data.name !== undefined && data.name.trim() === "") {
    throw new AppError("Organisation name cannot be empty", 400, "VALIDATION_ERROR");
  }

  const updateData: Record<string, string> = {};
  if (data.name) updateData.name = data.name.trim();
  if (data.slug) updateData.slug = data.slug;

  if (Object.keys(updateData).length === 0) {
    throw new AppError("No fields to update", 400, "VALIDATION_ERROR");
  }

  const updated = await prisma.organisation.update({
    where: { id: organisationId },
    data: updateData,
    select: {
      id: true,
      name: true,
      slug: true,
      plan: true,
      createdAt: true,
    },
  });

  return updated;
};

/**
 * Returns all users belonging to the given organisation,
 * plus any pending (unused, non-expired) invites as "virtual" members.
 */
export const getMembers = async (organisationId: string) => {
  // Fetch real users
  const members = await prisma.user.findMany({
    where: { organisationId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      role: true,
      isActive: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });

  // Fetch pending invites (not used, not expired)
  const pendingInvites = await prisma.inviteToken.findMany({
    where: {
      organisationId,
      usedAt: null,
      expiresAt: { gt: new Date() },
    },
    select: {
      id: true,
      email: true,
      role: true,
      createdAt: true,
      expiresAt: true,
    },
    orderBy: { createdAt: "asc" },
  });

  // Convert pending invites to member-like objects
  const pendingMembers = pendingInvites.map((invite) => ({
    id: invite.id,
    firstName: "",
    lastName: "",
    email: invite.email,
    role: invite.role,
    isActive: false,
    isPending: true,
    createdAt: invite.createdAt,
    expiresAt: invite.expiresAt,
  }));

  // Return real members + pending invites
  return {
    members,
    pendingInvites: pendingMembers,
  };
};

/**
 * Changes a member's role.
 * Blocks if the action would leave zero admins in the organisation.
 */
export const updateMemberRole = async (
  organisationId: string,
  targetUserId: string,
  newRole: "ADMIN" | "RECRUITER"
) => {
  // Verify target user belongs to the same organisation
  const targetUser = await prisma.user.findFirst({
    where: { id: targetUserId, organisationId },
  });

  if (!targetUser) {
    throw new AppError("User not found in your organisation", 404, "USER_NOT_FOUND");
  }

  // If demoting from ADMIN to RECRUITER, check if they're the last admin
  if (targetUser.role === "ADMIN" && newRole === "RECRUITER") {
    const adminCount = await prisma.user.count({
      where: {
        organisationId,
        role: "ADMIN",
        isActive: true,
      },
    });

    if (adminCount <= 1) {
      throw new AppError(
        "Cannot demote the last remaining admin. Promote another member to admin first.",
        400,
        "LAST_ADMIN"
      );
    }
  }

  const updated = await prisma.user.update({
    where: { id: targetUserId },
    data: { role: newRole },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      role: true,
      isActive: true,
      createdAt: true,
    },
  });

  return updated;
};

/**
 * Deactivates a member's account and revokes all their refresh tokens.
 * Blocks if the target is the last remaining admin.
 */
export const deactivateMember = async (
  organisationId: string,
  targetUserId: string,
  _requestingUserId: string
) => {
  // Verify target user belongs to the same organisation
  const targetUser = await prisma.user.findFirst({
    where: { id: targetUserId, organisationId },
  });

  if (!targetUser) {
    throw new AppError("User not found in your organisation", 404, "USER_NOT_FOUND");
  }

  if (!targetUser.isActive) {
    throw new AppError("This user is already deactivated", 400, "ALREADY_DEACTIVATED");
  }

  // Prevent self-deactivation if last admin
  if (targetUser.role === "ADMIN") {
    const adminCount = await prisma.user.count({
      where: {
        organisationId,
        role: "ADMIN",
        isActive: true,
      },
    });

    if (adminCount <= 1) {
      throw new AppError(
        "Cannot remove the last remaining admin. Promote another member to admin first.",
        400,
        "LAST_ADMIN"
      );
    }
  }

  // Deactivate user and revoke all refresh tokens in a transaction
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: targetUserId },
      data: { isActive: false },
    });

    // Revoke all refresh tokens immediately
    await tx.refreshToken.deleteMany({
      where: { userId: targetUserId },
    });
  });

  return { success: true, message: "Member deactivated successfully" };
};

/**
 * Creates a JWT-signed invite token and sends an email via Brevo.
 * Uses the same pattern as SCRUM-5: JWT containing { email, organisationId, role }.
 */
export const createInvite = async (
  organisationId: string,
  email: string,
  role: "ADMIN" | "RECRUITER",
  _invitedById: string
) => {
  // Validate email format
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new AppError("A valid email address is required", 400, "VALIDATION_ERROR");
  }

  // Check if user with this email already exists in the organisation
  const existingUser = await prisma.user.findFirst({
    where: { email, organisationId },
  });

  if (existingUser) {
    throw new AppError(
      "This email is already a member of your organisation",
      409,
      "INVITE_ALREADY_MEMBER"
    );
  }

  // Check for existing pending invite
  const existingInvite = await prisma.inviteToken.findFirst({
    where: {
      email,
      organisationId,
      usedAt: null,
      expiresAt: { gt: new Date() },
    },
  });

  if (existingInvite) {
    throw new AppError(
      "An active invite already exists for this email",
      409,
      "INVITE_ALREADY_EXISTS"
    );
  }

  // Generate a signed JWT invite token (48h expiry)
  const token = jwt.sign(
    { jti: randomUUID(), email, organisationId, role },
    process.env.JWT_SECRET!,
    { expiresIn: "48h" }
  );

  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48 hours

  // Get organisation name for the email
  const org = await prisma.organisation.findUnique({
    where: { id: organisationId },
    select: { name: true },
  });

  if (!org) {
    throw new AppError("Organisation not found", 404, "ORG_NOT_FOUND");
  }

  // Store the invite token in the database
  const invite = await prisma.inviteToken.create({
    data: {
      token,
      email,
      organisationId,
      role,
      expiresAt,
    },
    select: {
      id: true,
      email: true,
      role: true,
      expiresAt: true,
      createdAt: true,
    },
  });

  // Build the invite link and send the email
  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
  const inviteLink = `${frontendUrl}/accept-invite?token=${token}`;

  await sendInviteEmail({
    to: email,
    inviteLink,
    organisationName: org.name,
    role,
  });

  return invite;
};
