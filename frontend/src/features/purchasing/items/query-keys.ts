import type { ItemsLookupType } from "@/lib/purchasing/items-lookup";

export const itemsQueryKeys = {
  all: ["purchasing", "items-lookup"] as const,
  byType: (type: ItemsLookupType) =>
    ["purchasing", "items-lookup", type] as const,
  list: (type: ItemsLookupType, search: string) =>
    ["purchasing", "items-lookup", type, "list", search] as const,
};
