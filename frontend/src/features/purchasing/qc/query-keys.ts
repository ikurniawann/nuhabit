import type { QCListParams } from "./types";

export const qcQueryKeys = {
  all: ["purchasing", "qc"] as const,
  list: (params: QCListParams) => ["purchasing", "qc", "list", params] as const,
  detail: (id: string) => ["purchasing", "qc", "detail", id] as const,
};
