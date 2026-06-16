import { prisma } from "@/lib/prisma";
import { AppError } from "@/utils/AppError";
import { getConfig } from "@/config";
import bcrypt from "bcrypt";
import crypto from "crypto";
import jwt from "jsonwebtoken";

const config = getConfig();

export interface RegisterInput {
  organisationName: string;
  firstName: string;
  lastName: string;
  email: string;
  password?: string;
}

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
  const result = await prisma.$transaction(async (tx) => {
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

    // Generate random 64-byte hex string Refresh Token
    const refreshTokenValue = crypto.randomBytes(64).toString("hex");
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30); // 30 days expiry

    // Save Refresh Token
    await tx.refreshToken.create({
      data: {
        token: refreshTokenValue,
        userId: user.id,
        expiresAt,
      },
    });

    return {
      user,
      refreshToken: refreshTokenValue,
    };
  });

  // 5. Generate Access Token (JWT, expires in 15 minutes, signed with JWT_SECRET)
  const accessToken = jwt.sign(
    {
      id: result.user.id,
      email: result.user.email,
      role: result.user.role,
      organisationId: result.user.organisationId,
    },
    config.jwtSecret,
    { expiresIn: "15m" }
  );

  // 6. Return 201 response body structure (never return passwordHash)
  return {
    user: {
      id: result.user.id,
      email: result.user.email,
      firstName: result.user.firstName,
      lastName: result.user.lastName,
      role: result.user.role,
    },
    accessToken,
    refreshToken: result.refreshToken,
  };
};
