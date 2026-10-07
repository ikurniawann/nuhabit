import type { OpenBillsListParams } from "./types";

export const openBillsQueryKeys = {
  all: ["pos", "open-bills"] as const,
  list: (params: OpenBillsListParams) => ["pos", "open-bills", "list", params] as const,
};
