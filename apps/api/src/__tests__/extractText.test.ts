import { ParsingQualityError } from "@/lib/extractText";

// Mock pdfjs-dist dynamic import and mammoth before importing extractText
jest.mock(
  "pdfjs-dist/legacy/build/pdf.mjs",
  () => ({
    GlobalWorkerOptions: { workerSrc: "" },
    getDocument: jest.fn(),
  }),
  { virtual: true }
);

jest.mock("mammoth", () => ({
  extractRawText: jest.fn(),
}));

// Mock require.resolve for the worker path
jest.mock(
  "path",
  () => ({ ...jest.requireActual("path") }),
  { virtual: false }
);

import mammoth from "mammoth";

const mockedMammoth = mammoth.extractRawText as jest.MockedFunction<
  typeof mammoth.extractRawText
>;

// Helper to get the pdfjs mock after jest.mock hoisting
function getPdfMock() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return jest.requireMock("pdfjs-dist/legacy/build/pdf.mjs") as {
    GlobalWorkerOptions: { workerSrc: string };
    getDocument: jest.Mock;
  };
}

function makePdfMock(pages: { items: { str: string; transform: number[] }[] }[]) {
  const pdfMock = getPdfMock();
  pdfMock.getDocument.mockReturnValue({
    promise: Promise.resolve({
      numPages: pages.length,
      getPage: jest.fn().mockImplementation(async (n: number) => ({
        getTextContent: jest.fn().mockResolvedValue({
          items: pages[n - 1].items.map((it) => ({
            ...it,
            dir: "ltr",
            width: 100,
            height: 12,
            fontName: "f1",
            hasEOL: false,
          })),
        }),
      })),
    }),
  });
}

describe("extractText — PDF", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Stub require.resolve used by getPdfWorkerUrl
    jest.spyOn(require("module"), "_resolveFilename").mockReturnValue(
      "/mock/path/pdf.worker.mjs"
    );
  });

  it("throws ParsingQualityError when extracted text is under 200 chars", async () => {
    makePdfMock([{ items: [{ str: "Short", transform: [12, 0, 0, 12, 100, 700] }] }]);

    const { extractText } = await import("@/lib/extractText");
    await expect(extractText(Buffer.from("pdf"), "file.pdf")).rejects.toThrow(
      ParsingQualityError
    );
  });

  it("sorts items top-to-bottom and left-to-right", async () => {
    const longText = "A".repeat(25);
    // Two items: bottom-left then top-right — should come out top-right first
    makePdfMock([
      {
        items: [
          { str: "BOTTOM_LEFT", transform: [12, 0, 0, 12, 50, 100] },
          { str: "TOP_RIGHT", transform: [12, 0, 0, 12, 300, 700] },
          ...Array.from({ length: 20 }, (_, i) => ({
            str: longText,
            transform: [12, 0, 0, 12, 50, 600 - i * 20],
          })),
        ],
      },
    ]);

    const { extractText } = await import("@/lib/extractText");
    const text = await extractText(Buffer.from("pdf"), "file.pdf");
    expect(text.indexOf("TOP_RIGHT")).toBeLessThan(text.indexOf("BOTTOM_LEFT"));
  });
});

describe("extractText — DOCX post-processing", () => {
  beforeEach(() => jest.clearAllMocks());

  async function runDocx(raw: string): Promise<string> {
    mockedMammoth.mockResolvedValue({ value: raw } as never);
    // Re-import to pick up fresh mocks (module is cached, postProcessDocx is internal)
    const { extractText } = await import("@/lib/extractText");
    return extractText(Buffer.from("docx"), "file.docx");
  }

  it("throws ParsingQualityError when DOCX text is too short", async () => {
    mockedMammoth.mockResolvedValue({ value: "hi" } as never);
    const { extractText } = await import("@/lib/extractText");
    await expect(extractText(Buffer.from("docx"), "file.docx")).rejects.toThrow(
      ParsingQualityError
    );
  });

  it("removes repeated lines appearing 3 or more times", async () => {
    const repeated = "Page 1 of 5";
    const content = Array.from({ length: 200 }, (_, i) => `Content line ${i}`).join("\n");
    const raw = `${repeated}\n${content}\n${repeated}\n${repeated}\n${repeated}`;
    const result = await runDocx(raw);
    expect(result).not.toContain(repeated);
  });

  it("collapses multiple spaces to single space", async () => {
    const raw = Array.from({ length: 20 }, (_, i) => `Word   extra   spaces   line ${i}`).join("\n");
    const result = await runDocx(raw);
    expect(result).not.toMatch(/ {2,}/);
  });
});

describe("ParsingQualityError", () => {
  it("has the correct name and message", () => {
    const err = new ParsingQualityError("too short");
    expect(err.name).toBe("ParsingQualityError");
    expect(err.message).toBe("too short");
    expect(err).toBeInstanceOf(Error);
  });
});
