import type { MemberListParams } from "./types";

export const membersQueryKeys = {
  all: ["crm", "members"] as const,
  list: (params: MemberListParams) => ["crm", "members", "list", params] as const,
  detail: (id: string) => ["crm", "members", "detail", id] as const,
};
