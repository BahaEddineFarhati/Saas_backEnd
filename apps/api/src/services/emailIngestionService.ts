import { prisma } from "@/lib/prisma";
import { sendInboundEmailAutoReply } from "@/services/emailService";
import { createPendingCandidateFromFile } from "@/services/jobService";
import { parseEmailSubjectCode } from "@/utils/parseEmailSubject";
import { EmailIngestionStatus } from "@prisma/client";

interface AttachmentLike {
  fieldname: string;
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

interface InboundEmailPayload {
  senderEmail: string;
  subject?: string | null;
  recipients: string[];
  attachments: AttachmentLike[];
  spamScore?: number | null;
  spamReport?: string | null;
}

const ACCEPTED_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

const MAX_ATTACHMENT_SIZE = 5 * 1024 * 1024;

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

const detectOutcomeStatus = (processedCount: number, rejectedCount: number, attachmentCount: number) => {
  if (processedCount > 0 && rejectedCount === 0) {
    return EmailIngestionStatus.PROCESSED;
  }

  if (processedCount > 0 && rejectedCount > 0) {
    return EmailIngestionStatus.PARTIAL;
  }

  if (attachmentCount === 0) {
    return EmailIngestionStatus.REJECTED;
  }

  return EmailIngestionStatus.REJECTED;
};

export const processInboundEmail = async (payload: InboundEmailPayload) => {
  const { senderEmail, subject, recipients, attachments, spamScore, spamReport } = payload;
  const recipientEmail = recipients[0] ?? "";

  if (typeof spamScore === "number" && spamScore > 5.0) {
    await prisma.emailIngestionLog.create({
      data: {
        senderEmail,
        subject: subject ?? null,
        recipientEmail,
        attachmentCount: attachments.length,
        processedCount: 0,
        rejectedCount: attachments.length,
        spamScore,
        status: EmailIngestionStatus.SPAM,
        errorMessage: spamReport ?? "Email flagged as spam by SendGrid",
      },
    });

    return { status: 200, createdCandidate: false, autoReplySent: false };
  }

  const subjectCode = parseEmailSubjectCode(subject);
  let matchedJobs = [] as Array<{ id: string; title: string }>;

  if (subjectCode) {
    const jobsByCode = await prisma.jobOpening.findMany({
      where: { inboundEmailCode: subjectCode },
      select: {
        id: true,
        title: true,
        inboundEmail: true,
        inboundEmailCode: true,
      },
    });

    matchedJobs = jobsByCode.map((job) => ({ id: job.id, title: job.title }));
  }

  if (matchedJobs.length === 0 && recipients.length > 0) {
    const jobsByRecipient = await prisma.jobOpening.findMany({
      where: {
        OR: recipients.map((recipient) => ({ inboundEmail: recipient })),
      },
      select: {
        id: true,
        title: true,
        inboundEmail: true,
        inboundEmailCode: true,
      },
    });

    const seenJobIds = new Set<string>();
    matchedJobs = [];

    for (const job of jobsByRecipient) {
      if (seenJobIds.has(job.id)) continue;
      seenJobIds.add(job.id);
      matchedJobs.push({ id: job.id, title: job.title });
    }
  }

  if (matchedJobs.length === 0) {
    await prisma.emailIngestionLog.create({
      data: {
        senderEmail,
        subject: subject ?? null,
        recipientEmail,
        attachmentCount: attachments.length,
        processedCount: 0,
        rejectedCount: attachments.length,
        spamScore: typeof spamScore === "number" ? spamScore : null,
        status: EmailIngestionStatus.JOB_NOT_FOUND,
        errorMessage: "No matching job opening found for the provided email address or subject code.",
      },
    });

    await sendInboundEmailAutoReply({
      to: senderEmail,
      jobTitle: "cette offre",
      reason: "job_not_found",
    });

    return { status: 200, createdCandidate: false, autoReplySent: true };
  }

  let processedCount = 0;
  let rejectedCount = 0;
  let createdCandidate = false;

  for (const job of matchedJobs) {
    let acceptedAttachment = null as AttachmentLike | null;

    for (const attachment of attachments) {
      if (!ACCEPTED_MIME_TYPES.has(attachment.mimetype)) {
        rejectedCount += 1;
        continue;
      }

      if (attachment.size > MAX_ATTACHMENT_SIZE) {
        rejectedCount += 1;
        continue;
      }

      acceptedAttachment = attachment;
      break;
    }

    if (acceptedAttachment) {
      await createPendingCandidateFromFile(
        job.id,
        acceptedAttachment.buffer,
        acceptedAttachment.originalname,
        acceptedAttachment.mimetype
      );
      processedCount += 1;
      createdCandidate = true;
    } else if (attachments.length > 0) {
      rejectedCount += attachments.length;
    }
  }

  const outcomeStatus = detectOutcomeStatus(processedCount, rejectedCount, attachments.length);

  await prisma.emailIngestionLog.create({
    data: {
      senderEmail,
      subject: subject ?? null,
      recipientEmail,
      attachmentCount: attachments.length,
      processedCount,
      rejectedCount,
      spamScore: typeof spamScore === "number" ? spamScore : null,
      status: outcomeStatus,
      errorMessage:
        processedCount > 0
          ? null
          : "No valid attachment was accepted for processing.",
    },
  });

  if (matchedJobs.length > 0) {
    const outcome = processedCount > 0 ? "processed" : "invalid_attachment";
    await sendInboundEmailAutoReply({
      to: senderEmail,
      jobTitle: matchedJobs[0]?.title ?? "cette offre",
      reason: outcome,
    });
  }

  return {
    status: 200,
    createdCandidate,
    autoReplySent: true,
  };
};
