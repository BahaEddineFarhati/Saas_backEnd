import bcrypt from "bcrypt";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/utils/AppError";
import { generateAccessToken, generateRefreshToken } from "@/utils/jwt";

/**
 * Get the authenticated user's profile information.
 * Includes organisation details but never returns passwordHash.
 *
 * @param userId The ID of the authenticated user
 * @returns User profile with organisation info
 */
export const getUserProfile = async (userId: string) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      role: true,
      organisationId: true,
      createdAt: true,
      organisation: {
        select: {
          id: true,
          name: true,
          slug: true,
        },
      },
    },
  });

  if (!user) {
    throw new AppError("User not found", 404, "USER_NOT_FOUND");
  }

  return {
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    role: user.role,
    organisation: user.organisation,
    createdAt: user.createdAt,
  };
};

/**
 * Update user profile fields (firstName, lastName, email).
 * If email is changed, invalidates all existing refresh tokens
 * and returns new access token and refresh token.
 * If only name fields are changed, does not rotate tokens.
 *
 * @param userId The ID of the authenticated user
 * @param updates Object with optional firstName, lastName, email
 * @returns Updated user profile and optionally new tokens if email changed
 */
export const updateUserProfile = async (
  userId: string,
  updates: {
    firstName?: string;
    lastName?: string;
    email?: string;
  }
) => {
  // Validate non-empty strings
  if (updates.firstName !== undefined && (!updates.firstName || typeof updates.firstName !== "string")) {
    throw new AppError("firstName must be a non-empty string", 400, "VALIDATION_ERROR");
  }
  if (updates.lastName !== undefined && (!updates.lastName || typeof updates.lastName !== "string")) {
    throw new AppError("lastName must be a non-empty string", 400, "VALIDATION_ERROR");
  }

  // Validate email format
  if (updates.email !== undefined) {
    if (!updates.email || typeof updates.email !== "string") {
      throw new AppError("email must be a non-empty string", 400, "VALIDATION_ERROR");
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(updates.email)) {
      throw new AppError("Invalid email format", 400, "VALIDATION_ERROR");
    }
  }

  // Get current user
  const user = await prisma.user.findUnique({
    where: { id: userId },
  });

  if (!user) {
    throw new AppError("User not found", 404, "USER_NOT_FOUND");
  }

  // Check if email is already taken (if email is being changed)
  if (updates.email && updates.email !== user.email) {
    const existingUser = await prisma.user.findUnique({
      where: { email: updates.email },
    });

    if (existingUser) {
      throw new AppError("Email is already in use", 409, "PROFILE_EMAIL_TAKEN");
    }
  }

  // Update user profile
  const updatedUser = await prisma.user.update({
    where: { id: userId },
    data: {
      firstName: updates.firstName !== undefined ? updates.firstName : user.firstName,
      lastName: updates.lastName !== undefined ? updates.lastName : user.lastName,
      email: updates.email !== undefined ? updates.email : user.email,
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      role: true,
    },
  });

  // If email was changed, invalidate all refresh tokens and return new tokens
  if (updates.email && updates.email !== user.email) {
    // Delete all refresh tokens for this user
    await prisma.refreshToken.deleteMany({
      where: { userId },
    });

    // Generate new tokens
    const accessToken = generateAccessToken(userId, user.organisationId, user.role);
    const refreshToken = generateRefreshToken(userId);

    // Store new refresh token
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await prisma.refreshToken.create({
      data: {
        token: refreshToken,
        userId,
        expiresAt,
      },
    });

    return {
      user: updatedUser,
      accessToken,
      refreshToken,
    };
  }

  // If only name fields were updated, do not rotate tokens
  return {
    user: updatedUser,
  };
};

/**
 * Change user password.
 * Validates current password, validates new password requirements,
 * and invalidates all refresh tokens on success.
 *
 * @param userId The ID of the authenticated user
 * @param passwords Object with currentPassword, newPassword, confirmNewPassword
 * @returns Message and new tokens
 */
export const changeUserPassword = async (
  userId: string,
  passwords: {
    currentPassword: string;
    newPassword: string;
    confirmNewPassword: string;
  }
) => {
  // Validate all fields are provided
  if (
    !passwords.currentPassword ||
    !passwords.newPassword ||
    !passwords.confirmNewPassword
  ) {
    throw new AppError(
      "currentPassword, newPassword, and confirmNewPassword are required",
      400,
      "VALIDATION_ERROR"
    );
  }

  // Get user with password hash
  const user = await prisma.user.findUnique({
    where: { id: userId },
  });

  if (!user) {
    throw new AppError("User not found", 404, "USER_NOT_FOUND");
  }

  if (!user.passwordHash || typeof user.passwordHash !== "string") {
    throw new AppError("Current password is incorrect", 401, "PROFILE_WRONG_PASSWORD");
  }

  // Verify current password
  const isPasswordValid = await bcrypt.compare(
    passwords.currentPassword,
    user.passwordHash
  );

  if (!isPasswordValid) {
    throw new AppError("Current password is incorrect", 401, "PROFILE_WRONG_PASSWORD");
  }

  // Validate new password matches confirm
  if (passwords.newPassword !== passwords.confirmNewPassword) {
    throw new AppError(
      "New passwords do not match",
      400,
      "PROFILE_PASSWORDS_DO_NOT_MATCH"
    );
  }

  // Validate new password requirements
  if (passwords.newPassword.length < 8) {
    throw new AppError(
      "Password must be at least 8 characters long",
      400,
      "VALIDATION_ERROR"
    );
  }
  if (!/[A-Z]/.test(passwords.newPassword)) {
    throw new AppError(
      "Password must contain at least one uppercase letter",
      400,
      "VALIDATION_ERROR"
    );
  }
  if (!/[0-9]/.test(passwords.newPassword)) {
    throw new AppError(
      "Password must contain at least one number",
      400,
      "VALIDATION_ERROR"
    );
  }

  // Hash new password
  const hashedPassword = await bcrypt.hash(passwords.newPassword, 12);

  // Update password and invalidate all refresh tokens
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: hashedPassword },
  });

  // Delete all refresh tokens for this user
  await prisma.refreshToken.deleteMany({
    where: { userId },
  });

  // Generate new tokens
  const accessToken = generateAccessToken(userId, user.organisationId, user.role);
  const refreshToken = generateRefreshToken(userId);

  // Store new refresh token
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await prisma.refreshToken.create({
    data: {
      token: refreshToken,
      userId,
      expiresAt,
    },
  });

  return {
    message: "Password updated successfully",
    accessToken,
    refreshToken,
  };
};
