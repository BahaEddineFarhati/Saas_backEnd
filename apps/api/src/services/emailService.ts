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

export const sendInviteEmail = async (params: InviteEmailParams): Promise<void> => {
  const { to, inviteLink, organisationName, role } = params;
  const fromEmail = process.env.BREVO_FROM_EMAIL ?? "noreply@linkup.app";
  const fromName = process.env.BREVO_FROM_NAME ?? "LinkUp";

  if (!process.env.BREVO_SMTP_USER || !process.env.BREVO_SMTP_PASS) {
    console.warn(
      `[emailService] SMTP not configured — skipping send.\n` +
        `  Invite link for ${to}: ${inviteLink}`
    );
    return;
  }

  const transporter = createTransporter();

  await transporter.sendMail({
    from: `"${fromName}" <${fromEmail}>`,
    to,
    subject: `You've been invited to join ${organisationName} on LinkUp`,
    text:
      `You've been invited to join ${organisationName} as a ${role}.\n\n` +
      `Accept your invitation here: ${inviteLink}\n\n` +
      `This link expires in 48 hours.`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
        <h2>You're invited to join ${organisationName}!</h2>
        <p>You've been invited as a <strong>${role}</strong>.</p>
        <p style="margin:32px 0">
          <a href="${inviteLink}"
             style="background:#4F46E5;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600">
            Accept Invitation
          </a>
        </p>
        <p style="color:#6B7280;font-size:14px">This link expires in 48 hours.</p>
        <p style="color:#6B7280;font-size:12px"><a href="${inviteLink}">${inviteLink}</a></p>
      </div>
    `,
  });
};
