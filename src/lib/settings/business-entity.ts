import { ApiError } from "@/lib/api/auth";
import type { BusinessEntityType } from "@/lib/configuration/business-repository";

export const BUSINESS_ENTITY_TYPES = ["holding", "company", "branch", "warehouse"] as const satisfies readonly BusinessEntityType[];

/** Segmen URL → tipe entitas bisnis; 400 bila tidak dikenal. */
export function parseBusinessEntityType(value: string): BusinessEntityType {
  if (!(BUSINESS_ENTITY_TYPES as readonly string[]).includes(value)) {
    throw ApiError.badRequest("Tipe entitas tidak valid");
  }
  return value as BusinessEntityType;
}
