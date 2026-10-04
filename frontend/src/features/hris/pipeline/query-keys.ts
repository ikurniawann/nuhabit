export const pipelineQueryKeys = {
  all: ["hris", "pipeline"] as const,
  candidates: () => ["hris", "pipeline", "candidates"] as const,
  brands: () => ["hris", "pipeline", "brands"] as const,
  aiAnalysis: (candidateId: string) =>
    ["hris", "pipeline", "ai-analysis", candidateId] as const,
  notes: (candidateId: string) =>
    ["hris", "pipeline", "notes", candidateId] as const,
  screening: (candidateId: string) =>
    ["hris", "pipeline", "screening", candidateId] as const,
  psikotes: (candidateId: string) =>
    ["hris", "pipeline", "psikotes", candidateId] as const,
  psikotesProctor: (sessionId: string) =>
    ["hris", "pipeline", "psikotes-proctor", sessionId] as const,
  psikotesAnswers: (testId: string) =>
    ["hris", "pipeline", "psikotes-answers", testId] as const,
  interview: (candidateId: string) =>
    ["hris", "pipeline", "interview", candidateId] as const,
  interviewProctor: (sessionId: string) =>
    ["hris", "pipeline", "interview-proctor", sessionId] as const,
  offers: (candidateId: string) =>
    ["hris", "pipeline", "offers", candidateId] as const,
  interviewRecordings: (sessionId: string) =>
    ["hris", "pipeline", "interview-recordings", sessionId] as const,
};
