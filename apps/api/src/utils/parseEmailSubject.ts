export const parseEmailSubjectCode = (subject?: string | null): string | null => {
  if (!subject) {
    return null;
  }

  const match = subject.trim().match(/^\[([A-Z0-9]{6})\]/i);
  return match?.[1]?.toUpperCase() ?? null;
};
