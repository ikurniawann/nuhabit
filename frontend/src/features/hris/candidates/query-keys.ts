import type { CandidateListParams } from "./types";

export const candidatesQueryKeys = {
  all: ["hris", "candidates"] as const,
  list: (params: CandidateListParams) => ["hris", "candidates", "list", params] as const,
  brands: () => ["hris", "candidates", "brands"] as const,
  detail: (id: string) => ["hris", "candidates", "detail", id] as const,
};
