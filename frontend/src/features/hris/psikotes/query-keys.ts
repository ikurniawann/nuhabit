export const psikotesQueryKeys = {
  all: ["hris", "psikotes"] as const,
  instruments: () => ["hris", "psikotes", "instruments"] as const,
  questions: (instrumentId: string) =>
    ["hris", "psikotes", "questions", instrumentId] as const,
};
