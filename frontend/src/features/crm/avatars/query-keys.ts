import type { AvatarsListParams } from "./types";

export const avatarsQueryKeys = {
  all: ["crm", "avatars"] as const,
  list: (params: AvatarsListParams) => ["crm", "avatars", "list", params] as const,
};
