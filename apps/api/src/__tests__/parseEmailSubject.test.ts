
describe("parseEmailSubjectCode", () => {
  it("extracts a 6-character code from a subject prefix", () => {
    expect(parseEmailSubjectCode("[A3K9F2] Candidature Développeur Frontend")).toBe("A3K9F2");
  });

  it("returns null when the subject does not start with a bracketed code", () => {
    expect(parseEmailSubjectCode("Candidature Développeur Frontend")).toBeNull();
  });

  it("returns null when the code is not 6 characters long", () => {
    expect(parseEmailSubjectCode("[ABC] Candidature")).toBeNull();
  });
});
export const parseEmailSubjectCode = (subject?: string | null): string | null => {
  if (!subject) {
    return null;
  }

  const match = subject.trim().match(/^\[([A-Z0-9]{6})\]/i);
  return match?.[1]?.toUpperCase() ?? null;
};
