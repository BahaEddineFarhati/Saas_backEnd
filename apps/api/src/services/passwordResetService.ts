import { prisma } from "@/lib/prisma";
import { AppError } from "@/utils/AppError";
import * as bcrypt from "bcrypt";
import { sendPasswordResetEmail } from "./emailService";
import { randomBytes } from "crypto";

const SALT_ROUNDS = 12;

export const requestPasswordReset = async (email: string): Promise<void> => {
  const user = await prisma.user.findUnique({ where: { email } });

  // Always return silently to avoid email enumeration
  if (!user) return;

  // If user is inactive or organisation suspended, do not send email
  if (!user.isActive) return;

  if (user.organisationId) {
    const org = await prisma.organisation.findUnique({ where: { id: user.organisationId } });
    if (org?.suspended) return;
  }

  // Delete any existing unused tokens for this user
  await prisma.passwordResetToken.deleteMany({ where: { userId: user.id, usedAt: null } });

  const token = randomBytes(64).toString("hex");
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

  await prisma.passwordResetToken.create({
    data: {
      token,
      userId: user.id,
      expiresAt,
    },
  });

  // Send email (best-effort)
  try {
    await sendPasswordResetEmail({ to: user.email, firstName: user.firstName, token });
  } catch (err) {
    // Log and continue — we do not propagate to caller to avoid revealing info
    console.error("Failed to send password reset email:", err);
  }
};

export const consumePasswordReset = async (token: string, newPassword: string, confirmNewPassword: string): Promise<void> => {
  const row = await prisma.passwordResetToken.findUnique({ where: { token } });

  if (!row) throw new AppError("Ce lien de réinitialisation est invalide.", 400, "RESET_TOKEN_INVALID");

  if (row.expiresAt.getTime() < Date.now()) {
    throw new AppError("Ce lien de réinitialisation a expiré. Veuillez en demander un nouveau.", 400, "RESET_TOKEN_EXPIRED");
  }

  if (row.usedAt) {
    throw new AppError("Ce lien de réinitialisation a déjà été utilisé.", 400, "RESET_TOKEN_ALREADY_USED");
  }

  // Password validations
  if (newPassword.length < 8) {
    throw new AppError("Le mot de passe doit contenir au moins 8 caractères.", 400, "VALIDATION_ERROR");
  }
  if (!/[A-Z]/.test(newPassword)) {
    throw new AppError("Le mot de passe doit contenir au moins une lettre majuscule.", 400, "VALIDATION_ERROR");
  }
  if (!/[0-9]/.test(newPassword)) {
    throw new AppError("Le mot de passe doit contenir au moins un chiffre.", 400, "VALIDATION_ERROR");
  }

  if (newPassword !== confirmNewPassword) {
    throw new AppError("Les mots de passe ne correspondent pas.", 400, "RESET_PASSWORDS_DO_NOT_MATCH");
  }

  const hashed = await bcrypt.hash(newPassword, SALT_ROUNDS);

  await prisma.$transaction([
    prisma.user.update({ where: { id: row.userId }, data: { passwordHash: hashed } }),
    prisma.passwordResetToken.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
    prisma.refreshToken.deleteMany({ where: { userId: row.userId } }),
  ]);
};

export default {
  requestPasswordReset,
  consumePasswordReset,
};
