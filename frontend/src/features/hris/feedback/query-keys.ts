export const feedbackQueryKeys = {
  all: ["hris", "feedback"] as const,
  cycles: () => ["hris", "feedback", "cycles"] as const,
  assignments: (cycleId: string) => ["hris", "feedback", "assignments", cycleId] as const,
  approvals: (status: string) => ["hris", "feedback", "approvals", status] as const,
  summaries: (cycleId: string) => ["hris", "feedback", "summaries", cycleId] as const,
  mine: () => ["hris", "feedback", "me"] as const,
  myDetail: (id: string) => ["hris", "feedback", "me", id] as const,
};
