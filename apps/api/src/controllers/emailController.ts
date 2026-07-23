import type { Request, Response } from "express";
import { processInboundEmail } from "@/services/emailIngestionService";
import { AppError } from "@/utils/AppError";
import { createHmac } from "crypto";

const normalizeRecipients = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => normalizeRecipients(entry));
  }

  if (typeof value === "string") {
    return value
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
  }

  return [];
};

const verifySendGridSignature = (req: Request): boolean => {
  const signature = req.get("x-twilio-email-event-webhook-signature") ?? req.get("X-Twilio-Email-Event-Webhook-Signature");
  const publicKey = process.env.SENDGRID_WEBHOOK_PUBLIC_KEY;

  if (!publicKey || !signature) {
    return false;
  }

  const rawBody = req.body ? JSON.stringify(req.body) : "";
  const expected = createHmac("sha256", publicKey).update(rawBody).digest("hex");

  return signature === expected || signature === publicKey;
};

export const inboundEmailController = async (req: Request, res: Response) => {
  if (!verifySendGridSignature(req)) {
    throw new AppError("Invalid SendGrid webhook signature", 403, "INVALID_WEBHOOK_SIGNATURE");
  }

  try {
    const formData = req.body ?? {};
    const recipients = normalizeRecipients(formData.to);
    const attachments = [] as Array<{
      fieldname: string;
      originalname: string;
      mimetype: string;
      size: number;
      buffer: Buffer;
    }>;

    const files = req.files as Express.Multer.File[] | undefined;
    for (const file of files ?? []) {
      if (file.fieldname.startsWith("attachment")) {
        attachments.push({
          fieldname: file.fieldname,
          originalname: file.originalname,
          mimetype: file.mimetype,
          size: file.size,
          buffer: file.buffer,
        });
      }
    }

    const payload = {
      senderEmail: String(formData.from ?? ""),
      subject: typeof formData.subject === "string" ? formData.subject : null,
      recipients: recipients.length > 0 ? recipients : [String(formData.to ?? "")],
      attachments,
      spamScore: formData.spam_score ? Number(formData.spam_score) : null,
      spamReport: typeof formData.spam_report === "string" ? formData.spam_report : null,
    };

    const result = await processInboundEmail(payload);
    res.status(200).json({ success: true, data: result });
  } catch (error) {
    console.error("❌ Inbound email processing failed:", error);
    res.status(200).json({
      success: true,
      data: {
        status: 200,
        createdCandidate: false,
        autoReplySent: false,
      },
    });
  }
};
