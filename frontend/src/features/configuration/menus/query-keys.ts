import type { ListParams } from "@/types/api";

export const menusQueryKeys = {
  all: ["configuration", "menus"] as const,
  list: (params?: ListParams) =>
    ["configuration", "menus", "list", params ?? {}] as const,
  detail: (id: string) => ["configuration", "menus", "detail", id] as const,
};
