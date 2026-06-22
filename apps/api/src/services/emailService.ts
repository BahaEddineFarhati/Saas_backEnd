import nodemailer from "nodemailer";

const createTransporter = () =>
  nodemailer.createTransport({
    host: process.env.BREVO_SMTP_HOST ?? "smtp-relay.brevo.com",
    port: parseInt(process.env.BREVO_SMTP_PORT ?? "587", 10),
    secure: false,
    auth: {
      user: process.env.BREVO_SMTP_USER,
      pass: process.env.BREVO_SMTP_PASS,
    },
  });

interface InviteEmailParams {
  to: string;
  inviteLink: string;
  organisationName: string;
  role: string;
}

/**
 * Sends an invite email via Brevo.
 * Supports Brevo API Key (preferred to bypass SMTP IP restrictions) or SMTP relay.
 * Falls back to console logging in development if no credentials are provided.
 */
export const sendInviteEmail = async (params: InviteEmailParams): Promise<void> => {
  const { to, inviteLink, organisationName, role } = params;
  const fromEmail = process.env.BREVO_FROM_EMAIL ?? "noreply@linkup.app";
  const fromName = process.env.BREVO_FROM_NAME ?? "LinkUp";

  const subject = `You've been invited to join ${organisationName} on LinkUp`;
  const text = `You've been invited to join ${organisationName} as a ${role}.\n\nAccept your invitation here: ${inviteLink}\n\nThis link expires in 48 hours.`;
  const html = `
    <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:560px;margin:0 auto;padding:32px;">
      <h2 style="color:#1a1a2e;">You're invited to join ${organisationName}!</h2>
      <p style="color:#444;line-height:1.6;">
        You've been invited as a <strong>${role}</strong>.
      </p>
      <p style="margin:32px 0;text-align:center;">
        <a href="${inviteLink}"
           style="display:inline-block;padding:14px 32px;background:linear-gradient(135deg,#7c3aed,#ec4899);
                  color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:16px;">
          Accept Invitation
        </a>
      </p>
      <p style="color:#888;font-size:13px;">
        This invitation expires in 48 hours. If you didn't expect this email, you can safely ignore it.
      </p>
      <p style="color:#6B7280;font-size:12px;">
        <a href="${inviteLink}" style="color:#7c3aed;">${inviteLink}</a>
      </p>
      <hr style="border:none;border-top:1px solid #eee;margin:24px 0;" />
      <p style="color:#aaa;font-size:12px;">LinkUp — AI-Powered Recruitment Platform</p>
    </div>
  `;

  // Method 1: Brevo Web API (Recommended because it avoids SMTP relay IP blocks)
  if (process.env.BREVO_API_KEY) {
    try {
      const response = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: {
          "accept": "application/json",
          "api-key": process.env.BREVO_API_KEY,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          sender: { name: fromName, email: fromEmail },
          to: [{ email: to }],
          subject,
          htmlContent: html,
          textContent: text,
        }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(JSON.stringify(errData));
      }

      console.log(`📧 Invite email sent via Brevo API to ${to}`);
      return;
    } catch (error) {
      console.error("❌ Failed to send email via Brevo API:", error);
      console.warn(
        `[emailService] API failed. Falling back to console logging.\n` +
          `  Invite link for ${to}: ${inviteLink}`
      );
      return;
    }
  }

  // Method 2: Brevo SMTP
  if (process.env.BREVO_SMTP_USER && process.env.BREVO_SMTP_PASS) {
    try {
      const transporter = createTransporter();
      await transporter.sendMail({
        from: `"${fromName}" <${fromEmail}>`,
        to,
        subject,
        text,
        html,
      });
      console.log(`📧 Invite email sent via SMTP to ${to}`);
      return;
    } catch (error) {
      console.error("❌ Failed to send email via SMTP:", error);
      console.warn(
        `[emailService] SMTP failed. Falling back to console logging.\n` +
          `  Invite link for ${to}: ${inviteLink}`
      );
      return;
    }
  }

  // Fallback: Console log
  console.warn(
    `[emailService] Neither Brevo API Key nor SMTP configured — skipping send.\n` +
      `  Invite link for ${to}: ${inviteLink}`
  );
};
