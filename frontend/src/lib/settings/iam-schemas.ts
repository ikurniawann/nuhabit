import { z } from "zod";
import { MENU_TYPES } from "@/lib/iam/types";

const optionalText = z.string().nullable().optional();

export const menuPayloadSchema = z.object({
  parentId: z.string().nullable().optional(),
  code: z.string().trim().min(1).max(100),
  menuName: z.string().trim().min(1).max(200),
  description: optionalText,
  routePath: optionalText,
  module: optionalText,
  menuType: z.enum(MENU_TYPES).optional(),
  icon: optionalText,
  orderNumber: z.number().int().optional(),
  isVisible: z.boolean().optional(),
  isActive: z.boolean().optional(),
  openInNewTab: z.boolean().optional(),
  permissionContext: z.object({ actions: z.array(z.string()) }).optional(),
});

export const menuUpdateSchema = menuPayloadSchema.partial();

export const roleCreateSchema = z.object({
  code: z.string().trim().min(1, "Code and name are required"),
  name: z.string().trim().min(1, "Code and name are required"),
  description: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
});

export const roleUpdateSchema = z.object({
  code: z.string().optional(),
  name: z.string().optional(),
  description: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
});

export const rolePermissionsSchema = z.object({
  permissions: z
    .array(
      z.object({
        menuId: z.string().optional(),
        isGranted: z.boolean().optional(),
        grantedActions: z.array(z.string()).optional(),
      })
    )
    .default([]),
});

/** Baris izin yang dicentang saja; tanpa daftar aksi berarti hanya "read". */
export function normalizeRolePermissions(input: z.infer<typeof rolePermissionsSchema>["permissions"]) {
  return input
    .filter((item): item is typeof item & { menuId: string } => Boolean(item.menuId) && item.isGranted !== false)
    .map((item) => ({ menuId: item.menuId, grantedActions: item.grantedActions ?? ["read"] }));
}
