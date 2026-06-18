import { createClient } from "@supabase/supabase-js";
import { getConfig } from "@/config";

const config = getConfig();

/**
 * Initialize Supabase client for file storage operations
 * Uses environment variables for URL and API key
 */
export const supabase = createClient(config.supabaseUrl, config.supabaseKey);

/**
 * Upload a file to Supabase Storage
 * Stores file in the configured bucket with a unique path
 *
 * @param file - File to upload (from multer)
 * @param jobId - ID of the job posting
 * @returns Object containing bucket name and file path
 * @throws Error if upload fails
 */
export const uploadFileToStorage = async (
  file: Express.Multer.File,
  jobId: string
): Promise<{ bucket: string; path: string }> => {
  const bucket = config.supabaseBucket;

  // Create unique path with timestamp and random string to avoid collisions
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(7);
  const fileExtension = file.originalname.split(".").pop();
  const uniqueFileName = `${timestamp}-${random}.${fileExtension}`;
  const filePath = `${jobId}/${uniqueFileName}`;

  try {
    const { error } = await supabase.storage
      .from(bucket)
      .upload(filePath, file.buffer, {
        contentType: file.mimetype,
        metadata: {
          originalName: file.originalname,
          uploadedAt: new Date().toISOString(),
        },
      });

    if (error) {
      throw new Error(`Supabase upload error: ${error.message}`);
    }

    return {
      bucket,
      path: filePath,
    };
  } catch (error) {
    console.error("File upload to Supabase failed:", error);
    throw error;
  }
};

/**
 * Generate a public URL for a file in storage
 * URL will be accessible without authentication
 *
 * @param bucket - Storage bucket name
 * @param path - File path in the bucket
 * @returns Public URL string
 */
export const getPublicFileUrl = (bucket: string, path: string): string => {
  // Construct the public URL following Supabase's pattern
  // Format: https://<project_id>.supabase.co/storage/v1/object/public/<bucket>/<path>
  return `${config.supabaseUrl}/storage/v1/object/public/${bucket}/${path}`;
};
