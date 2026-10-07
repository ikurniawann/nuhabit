import type { GeneralPRListParams } from "./types";

export const generalPrQueryKeys = {
  all: ["purchasing", "general-pr"] as const,
  list: (params: GeneralPRListParams) => ["purchasing", "general-pr", "list", params] as const,
  formData: () => ["purchasing", "general-pr", "form-data"] as const,
  detail: (id: string) => ["purchasing", "general-pr", "detail", id] as const,
};
