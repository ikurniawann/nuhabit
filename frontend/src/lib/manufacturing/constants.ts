import type { UserRole } from "@/types";

export const MANUFACTURING_SCHEMA = "manufacturing" as const;

/** Roles allowed to read/write production orders, recipes, and WIP. */
export const PRODUCTION_API_ROLES = [
  "super_admin",
  "admin",
  "purchasing_admin",
  "purchasing_manager",
  "purchasing_staff",
  "warehouse_admin",
  "warehouse_staff",
] as const satisfies readonly UserRole[];
