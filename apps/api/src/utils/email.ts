import nodemailer from "nodemailer";

/**
 * Creates a nodemailer transporter from env vars.
 * Falls back to console logging in development if SMTP is not configured.
 */
function getTransporter() {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || "587", 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    return null; // SMTP not configured — will log to console instead
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
}

/**
 * Sends an invite email to the given address with a link to accept.
 * If SMTP is not configured, logs the invite link to the console instead.
 */
export async function sendInviteEmail(
  to: string,
  inviteToken: string,
  organisationName: string
): Promise<void> {
  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
  const inviteLink = `${frontendUrl}/accept-invite?token=${inviteToken}`;

  const transporter = getTransporter();

  const subject = `You've been invited to join ${organisationName} on LinkUp`;
  const html = `
    <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 32px;">
      <h2 style="color: #1a1a2e;">You're invited!</h2>
      <p style="color: #444; line-height: 1.6;">
        You have been invited to join <strong>${organisationName}</strong> on LinkUp.
      </p>
      <p style="color: #444; line-height: 1.6;">
        Click the button below to create your account and get started:
      </p>
      <div style="text-align: center; margin: 32px 0;">
        <a href="${inviteLink}"
           style="display: inline-block; padding: 14px 32px; background: linear-gradient(135deg, #7c3aed, #ec4899);
                  color: #fff; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px;">
          Accept Invitation
        </a>
      </div>
      <p style="color: #888; font-size: 13px;">
        This invitation expires in 7 days. If you didn't expect this email, you can safely ignore it.
      </p>
      <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
      <p style="color: #aaa; font-size: 12px;">LinkUp — AI-Powered Recruitment Platform</p>
    </div>
  `;

  if (transporter) {
    const from = process.env.SMTP_FROM || "LinkUp <noreply@linkup.com>";
    await transporter.sendMail({ from, to, subject, html });
    console.log(`📧 Invite email sent to ${to}`);
  } else {
    // Development fallback: log the invite link
    console.log(`\n📧 ====== INVITE EMAIL (SMTP not configured) ======`);
    console.log(`   To: ${to}`);
    console.log(`   Organisation: ${organisationName}`);
    console.log(`   Accept link: ${inviteLink}`);
    console.log(`   ================================================\n`);
  }
}
