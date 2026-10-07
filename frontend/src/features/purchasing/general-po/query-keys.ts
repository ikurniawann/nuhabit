import type { GeneralPOListParams } from "./types";

export const generalPoQueryKeys = {
  all: ["purchasing", "general-po"] as const,
  list: (params: GeneralPOListParams) => ["purchasing", "general-po", "list", params] as const,
  detail: (id: string) => ["purchasing", "general-po", "detail", id] as const,
  formData: () => ["purchasing", "general-po", "form-data"] as const,
  approvedPRs: () => ["purchasing", "general-po", "approved-prs"] as const,
};
