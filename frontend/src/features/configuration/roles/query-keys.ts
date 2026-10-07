import type { ListParams } from "@/types/api";

export const rolesQueryKeys = {
  all: ["configuration", "roles"] as const,
  list: (params?: ListParams) =>
    ["configuration", "roles", "list", params ?? {}] as const,
  detail: (id: string) => ["configuration", "roles", "detail", id] as const,
  permissions: (id: string) =>
    ["configuration", "roles", "permissions", id] as const,
};
