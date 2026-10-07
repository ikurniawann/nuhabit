import type { POListParams } from "@/types/purchasing";

export const poQueryKeys = {
  all: ["purchasing", "po"] as const,
  list: (params: POListParams) => ["purchasing", "po", "list", params] as const,
  detail: (id: string) => ["purchasing", "po", "detail", id] as const,
  payments: (id: string) => ["purchasing", "po", "payments", id] as const,
  formData: ["purchasing", "po", "form-data"] as const,
  approvedPRs: ["purchasing", "po", "approved-prs"] as const,
};
