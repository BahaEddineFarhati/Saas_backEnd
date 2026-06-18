import multer, { FileFilterCallback } from "multer";
import { Request } from "express";

/**
 * Multer configuration for candidate file uploads
 * Handles validation of file types and sizes
 * Max 5MB per file, max 100 files per request
 */

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_FILES = 100;
const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // DOCX
];

/**
 * Storage strategy: Keep files in memory for Supabase upload
 * Files will be stored in object storage, not on disk
 */
const storage = multer.memoryStorage();

/**
 * File filter to validate MIME types and aggregate size
 * Only PDFs and DOCX files are allowed
 */
const fileFilter = (
  _req: Request,
  file: Express.Multer.File,
  cb: FileFilterCallback
) => {
  if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    return cb(
      new Error(
        `Invalid file type: ${file.originalname}. Only PDF and DOCX files are allowed.`
      )
    );
  }
  cb(null, true);
};

/**
 * Multer middleware configuration
 * Accepts up to 100 files with field name 'files'
 */
export const uploadMiddleware = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: MAX_FILES,
  },
});

/**
 * Custom validator function for uploaded files
 * Validates individual file sizes and collects errors
 * Returns array of validation errors, empty if all valid
 */
export interface FileValidationError {
  filename: string;
  reason: string;
}

export const validateUploadedFiles = (
  files: Express.Multer.File[]
): FileValidationError[] => {
  const errors: FileValidationError[] = [];

  if (!files || files.length === 0) {
    errors.push({
      filename: "request",
      reason: "No files provided in the upload request.",
    });
    return errors;
  }

  if (files.length > MAX_FILES) {
    errors.push({
      filename: "request",
      reason: `Too many files. Maximum ${MAX_FILES} files allowed per upload.`,
    });
  }

  files.forEach((file) => {
    // Check file size
    if (file.size > MAX_FILE_SIZE) {
      errors.push({
        filename: file.originalname,
        reason: `File exceeds 5MB limit (${(file.size / 1024 / 1024).toFixed(2)}MB).`,
      });
    }

    // Check MIME type
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      errors.push({
        filename: file.originalname,
        reason: `Unsupported file type. Only PDF and DOCX files are allowed.`,
      });
    }
  });

  return errors;
};
