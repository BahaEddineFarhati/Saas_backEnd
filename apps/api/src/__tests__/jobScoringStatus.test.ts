import { calculateScoringStatusSummary, sortCandidatesByScore } from "@/services/jobService";

describe("job scoring status helpers", () => {
  it("returns NOT_STARTED when no candidates have been parsed", () => {
    const summary = calculateScoringStatusSummary({
      totalCandidates: 3,
      parsedCount: 0,
      scoredCount: 0,
      failedCount: 0,
    });

    expect(summary.scoringStatus).toBe("NOT_STARTED");
    expect(summary).toEqual({
      totalCandidates: 3,
      parsedCount: 0,
      scoredCount: 0,
      failedCount: 0,
      scoringStatus: "NOT_STARTED",
    });
  });

  it("returns IN_PROGRESS when some parsed candidates are still unsorted", () => {
    const summary = calculateScoringStatusSummary({
      totalCandidates: 4,
      parsedCount: 3,
      scoredCount: 1,
      failedCount: 1,
    });

    expect(summary.scoringStatus).toBe("IN_PROGRESS");
  });

  it("returns COMPLETED when every parsed candidate has a score", () => {
    const summary = calculateScoringStatusSummary({
      totalCandidates: 4,
      parsedCount: 3,
      scoredCount: 3,
      failedCount: 1,
    });

    expect(summary.scoringStatus).toBe("COMPLETED");
  });

  it("sorts scored candidates by score descending and keeps null scores at the bottom", () => {
    const candidates = [
      { id: "1", score: null },
      { id: "2", score: 87 },
      { id: "3", score: 42 },
      { id: "4", score: 92 },
    ];

    const sorted = sortCandidatesByScore(candidates);

    expect(sorted.map((candidate) => candidate.id)).toEqual(["4", "2", "3", "1"]);
  });
});
