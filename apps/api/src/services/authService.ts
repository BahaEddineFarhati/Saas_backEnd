import bcrypt from "bcrypt";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/utils/AppError";
import {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
} from "@/utils/jwt";
import { LoginResponse, RefreshTokenResponse } from "@/types";


/**
 * Authenticates a user with email and password.
 * Returns access token, refresh token, and user data on success.
 * Blocks deactivated accounts.
 *
 * @throws AppError with generic message if credentials are invalid
 * @throws AppError 403 if account is deactivated
 */
export const login = async (
  email: string,
  password: string
): Promise<LoginResponse> => {
  // Find user by email
  const user = await prisma.user.findUnique({
    where: { email },
  });

  // Use generic error message for security (don't reveal if email exists)
  if (!user) {
    throw new AppError("Invalid email or password", 401, "INVALID_CREDENTIALS");
  }

  // Check if account is deactivated
  if (!user.isActive) {
    throw new AppError("Your account has been deactivated", 403, "ACCOUNT_DEACTIVATED");
  }

  // Compare passwords
  const isPasswordValid = await bcrypt.compare(password, user.passwordHash);

  if (!isPasswordValid) {
    throw new AppError("Invalid email or password", 401, "INVALID_CREDENTIALS");
  }

  // Generate tokens
  const accessToken = generateAccessToken(user.id, user.organisationId, user.role);
  const refreshToken = generateRefreshToken(user.id);

  // Calculate refresh token expiration (7 days from now)
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  // Store refresh token in database
  await prisma.refreshToken.create({
    data: {
      token: refreshToken,
      userId: user.id,
      expiresAt,
    },
  });

  return {
    accessToken,
    refreshToken,
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      organisationId: user.organisationId,
    },
  };
};

/**
 * Logs out a user by deleting their refresh token from the database.
 * Returns success regardless of whether the token existed (idempotent).
 *
 * @param refreshToken The refresh token to invalidate
 */
export const logout = async (refreshToken: string): Promise<void> => {
  // Find and delete the refresh token
  // Note: deleteMany returns deletedCount, but we don't throw if count is 0
  // because logout should be idempotent per requirements
  await prisma.refreshToken.deleteMany({
    where: {
      token: refreshToken,
    },
  });

  // No error thrown - logout always succeeds (idempotent behavior)
};

/**
 * Refreshes an access token using a valid refresh token.
 * Validates the refresh token and issues a new access token.
 * Automatically cleans up expired refresh tokens.
 *
 * @throws AppError if refresh token is invalid, expired, or not found
 */
export const refreshAccessToken = async (
  refreshToken: string
): Promise<RefreshTokenResponse> => {
  // Verify the refresh token signature and expiration
  const payload = verifyRefreshToken(refreshToken);

  if (!payload) {
    throw new AppError("Invalid or expired refresh token", 401, "INVALID_REFRESH_TOKEN");
  }

  // Find the refresh token in database
  const tokenRecord = await prisma.refreshToken.findUnique({
    where: { token: refreshToken },
  });

  if (!tokenRecord) {
    throw new AppError("Invalid or expired refresh token", 401, "INVALID_REFRESH_TOKEN");
  }

  // Check if token has expired
  if (tokenRecord.expiresAt < new Date()) {
    // Clean up expired token from database
    await prisma.refreshToken.delete({
      where: { token: refreshToken },
    });

    throw new AppError("Invalid or expired refresh token", 401, "INVALID_REFRESH_TOKEN");
  }

  // Verify user still exists and is active
  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
  });

  if (!user) {
    throw new AppError("User not found", 401, "USER_NOT_FOUND");
  }

  if (!user.isActive) {
    // Revoke the refresh token for deactivated users
    await prisma.refreshToken.delete({
      where: { token: refreshToken },
    });
    throw new AppError("Your account has been deactivated", 403, "ACCOUNT_DEACTIVATED");
  }

  // Generate new access token with org and role
  const newAccessToken = generateAccessToken(user.id, user.organisationId, user.role);

  return {
    accessToken: newAccessToken,
  };
};

/**
 * Accept an invite and create a new user account.
 * Validates the invite token, creates the user, and returns tokens.
 */
export const acceptInvite = async (input: {
  token: string;
  firstName: string;
  lastName: string;
  password: string;
}) => {
  const { token, firstName, lastName, password } = input;

  // Find the invite
  const invite = await prisma.invite.findUnique({
    where: { token },
    include: { organisation: true },
  });

  if (!invite) {
    throw new AppError("Invalid or expired invitation", 400, "INVALID_INVITE");
  }

  if (invite.acceptedAt) {
    throw new AppError("This invitation has already been accepted", 400, "INVITE_ALREADY_ACCEPTED");
  }

  if (invite.expiresAt < new Date()) {
    throw new AppError("This invitation has expired", 400, "INVITE_EXPIRED");
  }

  // Check if user with this email already exists
  const existingUser = await prisma.user.findUnique({
    where: { email: invite.email },
  });

  if (existingUser) {
    throw new AppError("An account with this email already exists", 409, "AUTH_EMAIL_TAKEN");
  }

  // Hash password
  const passwordHash = await bcrypt.hash(password, 12);

  // Create user and mark invite as accepted in a transaction
  return await prisma.$transaction(async (tx) => {
    // Create the user
    const user = await tx.user.create({
      data: {
        email: invite.email,
        firstName,
        lastName,
        passwordHash,
        role: invite.role,
        organisationId: invite.organisationId,
      },
    });

    // Mark invite as accepted
    await tx.invite.update({
      where: { id: invite.id },
      data: { acceptedAt: new Date() },
    });

    // Generate tokens
    const accessToken = generateAccessToken(user.id, user.organisationId, user.role);
    const refreshToken = generateRefreshToken(user.id);

    // Store refresh token
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await tx.refreshToken.create({
      data: {
        token: refreshToken,
        userId: user.id,
        expiresAt,
      },
    });

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        organisationId: user.organisationId,
      },
    };
  });
};
