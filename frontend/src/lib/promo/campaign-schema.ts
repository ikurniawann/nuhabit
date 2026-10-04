import { z } from "zod";
import { isValidCalendarDate } from "@/lib/ticketing/pricing";

// Field batas produk/kategori + kelayakan member, dipakai skema buat &
// edit campaign. Kosong = semua produk / semua pembeli.
export const campaignTargetFields = {
  target_product_ids: z.array(z.string().uuid()).max(200).optional(),
  target_category_ids: z.array(z.string().uuid()).max(100).optional(),
  eligibility: z.enum(["semua", "member", "member_baru"]).optional(),
  new_member_days: z.number().int().min(1).max(3650).nullable().optional(),
};

const dateField = z
  .string()
  .refine(isValidCalendarDate, "Tanggal tidak valid")
  .nullable()
  .optional();

const SCOPES = ["ticketing_online", "ticketing_loket", "pos", "semua"] as const;
const CODE_RULE = /^[A-Za-z0-9-]{3,40}$/;
const CODE_MESSAGE = "Kode: huruf/angka/strip, 3-40 karakter";
const PREFIX_RULE = /^[A-Za-z0-9]{2,12}$/;
const PREFIX_MESSAGE = "Prefix: huruf/angka, 2-12 karakter";

/** Maksimum kode per batch/sinkron jumlah voucher. */
const MAX_CODE_BATCH = 1000;

export const campaignCreateSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    description: z.string().trim().max(1000).nullable().optional(),
    discount_type: z.enum(["percent", "fixed"]),
    value: z.number().positive().max(1_000_000_000),
    max_discount: z.number().positive().max(1_000_000_000).nullable().optional(),
    min_purchase: z.number().min(0).max(1_000_000_000).default(0),
    valid_from: dateField,
    valid_until: dateField,
    usage_limit: z.number().int().positive().max(1_000_000).nullable().optional(),
    per_phone_limit: z.number().int().positive().max(100).nullable().default(1),
    scope: z.enum(SCOPES).default("ticketing_online"),
    ...campaignTargetFields,
    // Opsional: langsung buat SATU kode publik utk campaign ini
    public_code: z.string().trim().regex(CODE_RULE, CODE_MESSAGE).optional(),
  })
  .refine((b) => b.discount_type !== "percent" || b.value <= 100, {
    message: "Diskon persen maksimal 100",
    path: ["value"],
  })
  .refine(
    (b) => !b.valid_from || !b.valid_until || b.valid_until >= b.valid_from,
    { message: "Tanggal akhir sebelum tanggal mulai", path: ["valid_until"] }
  );
export type CampaignCreateInput = z.infer<typeof campaignCreateSchema>;

export const campaignPatchSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  discount_type: z.enum(["percent", "fixed"]).optional(),
  value: z.number().positive().max(1_000_000_000).optional(),
  max_discount: z.number().positive().max(1_000_000_000).nullable().optional(),
  min_purchase: z.number().min(0).max(1_000_000_000).optional(),
  valid_from: dateField,
  valid_until: dateField,
  usage_limit: z.number().int().positive().max(1_000_000).nullable().optional(),
  per_phone_limit: z.number().int().positive().max(100).nullable().optional(),
  scope: z.enum(SCOPES).optional(),
  is_active: z.boolean().optional(),
  show_in_member_portal: z.boolean().optional(),
  ...campaignTargetFields,
});
export type CampaignPatch = z.infer<typeof campaignPatchSchema>;

export const codeCreateSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("single"),
    code: z.string().trim().regex(CODE_RULE, CODE_MESSAGE),
    // null = ikut limit campaign (kode publik); isi utk membatasi kode ini
    usage_limit: z.number().int().positive().max(1_000_000).nullable().default(null),
  }),
  z.object({
    mode: z.literal("batch"),
    prefix: z.string().trim().regex(PREFIX_RULE, PREFIX_MESSAGE),
    count: z.number().int().min(1).max(MAX_CODE_BATCH),
  }),
]);
export type CodeCreateInput = z.infer<typeof codeCreateSchema>;

export const codeSyncSchema = z.object({
  target_count: z.number().int().min(0).max(MAX_CODE_BATCH),
  prefix: z.string().trim().regex(PREFIX_RULE, PREFIX_MESSAGE).optional(),
});
export type CodeSyncInput = z.infer<typeof codeSyncSchema>;

export const codePatchSchema = z.object({
  is_active: z.boolean().optional(),
  code: z.string().trim().regex(CODE_RULE, CODE_MESSAGE).optional(),
  usage_limit: z.number().int().positive().max(1_000_000).nullable().optional(),
});
export type CodePatch = z.infer<typeof codePatchSchema>;
