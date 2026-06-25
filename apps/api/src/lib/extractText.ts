import { pathToFileURL } from "url";
import mammoth from "mammoth";
import type { TextItem } from "pdfjs-dist/types/src/display/api";

export class ParsingQualityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ParsingQualityError";
  }
}

const MIN_TEXT_LENGTH = 200;

let pdfWorkerUrl: string | null = null;
function getPdfWorkerUrl(): string {
  if (!pdfWorkerUrl) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const workerPath = require.resolve(
      "pdfjs-dist/legacy/build/pdf.worker.mjs"
    );
    pdfWorkerUrl = pathToFileURL(workerPath).href;
  }
  return pdfWorkerUrl;
}

function isTextItem(it: unknown): it is TextItem {
  return typeof it === "object" && it !== null && "str" in it && "transform" in it;
}

// ── PDF extraction ────────────────────────────────────────────────────────────

async function extractPdfText(buffer: Buffer): Promise<string> {
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjsLib.GlobalWorkerOptions.workerSrc = getPdfWorkerUrl();

  const uint8 = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const pdf = await pdfjsLib
    .getDocument({ data: uint8, useSystemFonts: true })
    .promise;

  const pageTexts: string[] = [];

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();

    const items = content.items
      .filter(isTextItem)
      .filter((it) => it.str.trim() !== "");

    // Group items into lines by y-coordinate (±4 units tolerance)
    const lines: TextItem[][] = [];
    for (const item of items) {
      const y = (item.transform as number[])[5];
      const existing = lines.find(
        (l) => Math.abs((l[0].transform as number[])[5] - y) <= 4
      );
      if (existing) {
        existing.push(item);
      } else {
        lines.push([item]);
      }
    }

    // Sort lines top-to-bottom (higher y = higher on page in PDF coords)
    lines.sort(
      (a, b) => (b[0].transform as number[])[5] - (a[0].transform as number[])[5]
    );

    // Within each line, sort left-to-right by x
    const lineTexts = lines.map((line) => {
      line.sort(
        (a, b) => (a.transform as number[])[4] - (b.transform as number[])[4]
      );
      return line.map((it) => it.str).join(" ").replace(/\s+/g, " ").trim();
    });

    pageTexts.push(lineTexts.filter(Boolean).join("\n"));
  }

  return pageTexts.join("\n\n");
}

// ── DOCX extraction ───────────────────────────────────────────────────────────

async function extractDocxText(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer });
  return postProcessDocx(result.value);
}

function postProcessDocx(raw: string): string {
  const lines = raw.split("\n").map((l) => l.replace(/\t+/g, " ").replace(/ {2,}/g, " ").trim());

  // Count line frequency to detect repeated headers/footers (appear 3+ times)
  const freq = new Map<string, number>();
  for (const l of lines) {
    if (l.length > 0) freq.set(l, (freq.get(l) ?? 0) + 1);
  }
  const repeated = new Set([...freq.entries()].filter(([, n]) => n >= 3).map(([l]) => l));

  // Merge broken lines: if current line has no terminal punctuation and
  // next non-empty line starts with a lowercase letter, merge them
  const cleaned: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line || repeated.has(line)) continue;

    const next = lines.slice(i + 1).find((l) => l.length > 0);
    const endsWithPunct = /[.,:;!?)\]»]$/.test(line);
    const nextStartsLower = next ? /^[a-z]/.test(next) : false;

    if (!endsWithPunct && nextStartsLower && cleaned.length > 0) {
      cleaned[cleaned.length - 1] += " " + line;
    } else {
      cleaned.push(line);
    }
  }

  return cleaned.join("\n");
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function extractText(fileBuffer: Buffer, fileUrl: string): Promise<string> {
  const isDocx =
    fileUrl.toLowerCase().endsWith(".docx") ||
    fileUrl.toLowerCase().includes(".docx?");

  const raw = isDocx
    ? await extractDocxText(fileBuffer)
    : await extractPdfText(fileBuffer);

  const text = raw.replace(/\n{3,}/g, "\n\n").trim();

  if (text.length < MIN_TEXT_LENGTH) {
    throw new ParsingQualityError(
      `Extracted text is too short (${text.length} chars). ` +
        `The file may be image-based, password-protected, or corrupted.`
    );
  }

  return text;
}
