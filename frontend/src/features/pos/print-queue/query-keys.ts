import type { PrintJobListParams } from "./types";

export const printQueueQueryKeys = {
  all: ["pos", "print-queue"] as const,
  list: (params: PrintJobListParams) => ["pos", "print-queue", "list", params] as const,
};
