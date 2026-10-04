"use client";

import { useQuery } from "@tanstack/react-query";
import type { CustomFieldObject } from "@/lib/crm/custom-fields";
import { fetchCustomFieldDefs } from "./api";

export const customFieldKeys = {
  defs: (object: CustomFieldObject) => ["crm", "custom-fields", "defs", object] as const,
};

export const useCustomFieldDefs = (object: CustomFieldObject, enabled = true) =>
  useQuery({ queryKey: customFieldKeys.defs(object), queryFn: () => fetchCustomFieldDefs(object), staleTime: 5 * 60_000, enabled });
