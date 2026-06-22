import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { Readable } from "stream";
import { AppError } from "@/utils/AppError";

const endpoint = process.env.STORAGE_ENDPOINT!;
const accessKey = process.env.STORAGE_ACCESS_KEY!;
const secretKey = process.env.STORAGE_SECRET_KEY!;
const bucket = process.env.STORAGE_BUCKET!;
// STORAGE_PUBLIC_URL is optional: use it when the public-facing URL base differs
// from the S3 API endpoint (e.g. Cloudflare R2 with a custom / R2.dev domain).
const publicBase = (process.env.STORAGE_PUBLIC_URL ?? endpoint).replace(/\/$/, "");

const s3 = new S3Client({
  region: "auto",
  endpoint,
  credentials: {
    accessKeyId: accessKey,
    secretAccessKey: secretKey,
  },
  forcePathStyle: true,
});

/**
 * Uploads a file to the storage bucket.
 * @returns The public URL of the uploaded file.
 * @throws {AppError} on upload failure.
 */
export async function uploadFile(
  buffer: Buffer,
  filename: string,
  mimeType: string
): Promise<string> {
  try {
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: filename,
        Body: buffer,
        ContentType: mimeType,
      })
    );

    return `${publicBase}/${bucket}/${filename}`;
  } catch (err) {
    throw new AppError(
      `Failed to upload file: ${err instanceof Error ? err.message : String(err)}`,
      500,
      "STORAGE_UPLOAD_FAILED"
    );
  }
}

/**
 * Downloads a file from the storage bucket using its public URL.
 * @returns The file contents as a Buffer.
 */
export async function downloadFile(url: string): Promise<Buffer> {
  const prefix = `${publicBase}/${bucket}/`;

  if (!url.startsWith(prefix)) {
    throw new AppError(
      `Invalid storage URL: expected URL starting with ${prefix}`,
      400,
      "STORAGE_INVALID_URL"
    );
  }

  const key = url.slice(prefix.length);

  try {
    const response = await s3.send(
      new GetObjectCommand({ Bucket: bucket, Key: key })
    );

    if (!response.Body) {
      throw new AppError("Empty response body from storage.", 500, "STORAGE_EMPTY_BODY");
    }

    const stream = response.Body as Readable;
    return new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      stream.on("data", (chunk: Buffer) => chunks.push(chunk));
      stream.on("end", () => resolve(Buffer.concat(chunks)));
      stream.on("error", reject);
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(
      `Failed to download file: ${err instanceof Error ? err.message : String(err)}`,
      500,
      "STORAGE_DOWNLOAD_FAILED"
    );
  }
}

/**
 * Deletes a file from the storage bucket using its public URL.
 * @throws {AppError} if the URL is invalid or deletion fails.
 */
export async function deleteFile(url: string): Promise<void> {
  const prefix = `${publicBase}/${bucket}/`;

  if (!url.startsWith(prefix)) {
    throw new AppError(
      `Invalid storage URL: expected URL starting with ${prefix}`,
      400,
      "STORAGE_INVALID_URL"
    );
  }

  const key = url.slice(prefix.length);

  try {
    await s3.send(
      new DeleteObjectCommand({
        Bucket: bucket,
        Key: key,
      })
    );
  } catch (err) {
    throw new AppError(
      `Failed to delete file: ${err instanceof Error ? err.message : String(err)}`,
      500,
      "STORAGE_DELETE_FAILED"
    );
  }
}
