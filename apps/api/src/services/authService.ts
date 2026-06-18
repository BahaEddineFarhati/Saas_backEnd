import bcrypt from "bcrypt";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/utils/AppError";
import {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
} from "@/utils/jwt";
import { LoginResponse, RefreshTokenResponse, RegisterInput } from "@/types";





export const register = async (input: RegisterInput) => {
  const { organisationName, firstName, lastName, email, password } = input;

  // 1. Check if user already exists
  const existingUser = await prisma.user.findUnique({
    where: { email },
  });

  if (existingUser) {
    throw new AppError("Email already taken", 409, "AUTH_EMAIL_TAKEN");
  }

  // 2. Hash password with bcrypt at 12 rounds
  const passwordHash = await bcrypt.hash(password!, 12);

  // 3. Generate initial slug from organisation name
  let slug = organisationName
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!slug) slug = "org";

  // 4. Run database operations atomically in a transaction
  return await prisma.$transaction(async (tx) => {
    // Ensure slug is unique within the transaction
    let finalSlug = slug;
    const existingOrg = await tx.organisation.findUnique({
      where: { slug: finalSlug },
    });
    if (existingOrg) {
      finalSlug = `${slug}-${crypto.randomBytes(3).toString("hex")}`;
    }

    // Create Organisation
    const organisation = await tx.organisation.create({
      data: {
        name: organisationName,
        slug: finalSlug,
      },
    });

    // Create User as the first ADMIN of the Organisation
    const user = await tx.user.create({
      data: {
        email,
        firstName,
        lastName,
        passwordHash,
        role: "ADMIN",
        organisationId: organisation.id,
      },
    });

    // Generate tokens
    const accessToken = generateAccessToken(user.id, user.organisationId, user.role);
    const refreshToken = generateRefreshToken(user.id);

    // Calculate refresh token expiration (7 days from now)
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    // Store refresh token in database
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



/**
 * Authenticates a user with email and password.
 * Returns access token, refresh token, and user data on success.
 *
 * @throws AppError with generic message if credentials are invalid
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

  // Verify user still exists
  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
  });

  if (!user) {
    throw new AppError("User not found", 401, "USER_NOT_FOUND");
  }

  // Generate new access token
  const newAccessToken = generateAccessToken(user.id);

  return {
    accessToken: newAccessToken,
  };
};
