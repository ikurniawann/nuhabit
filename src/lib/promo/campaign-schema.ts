import { z } from "zod";

// Field batas produk/kategori + kelayakan member, dipakai skema buat &
// edit campaign. Kosong = semua produk / semua pembeli.
export const campaignTargetFields = {
  target_product_ids: z.array(z.string().uuid()).max(200).optional(),
  target_category_ids: z.array(z.string().uuid()).max(100).optional(),
  eligibility: z.enum(["semua", "member", "member_baru"]).optional(),
  new_member_days: z.number().int().min(1).max(3650).nullable().optional(),
};
