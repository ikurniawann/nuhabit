import type { VendorListParams } from "./types";

export const vendorsQueryKeys = {
  all: ["purchasing", "vendors"] as const,
  lists: () => [...vendorsQueryKeys.all, "list"] as const,
  list: (params: VendorListParams) => [...vendorsQueryKeys.lists(), params] as const,
  details: () => [...vendorsQueryKeys.all, "detail"] as const,
  detail: (id: string) => [...vendorsQueryKeys.details(), id] as const,
};
