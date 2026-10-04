import type { PRListParams } from "./types";

export const prQueryKeys = {
  all: ["purchasing", "pr"] as const,
  list: (params: PRListParams) => ["purchasing", "pr", "list", params] as const,
  detail: (id: string) => ["purchasing", "pr", "detail", id] as const,
  formData: () => ["purchasing", "pr", "form-data"] as const,
};
