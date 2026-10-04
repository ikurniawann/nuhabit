import { z } from "zod";
import { ApiError } from "@/lib/api/auth";
import type { PurchasingModuleType } from "@/lib/purchasing/module-scope";
import {
  clampMoney,
  MAX_NUMERIC_15_2,
  normalizePrQty,
  parseLocaleNumber,
  roundMoney,
} from "@/lib/purchasing/parse-locale-number";

function emptyToUndefined(value: unknown) {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "string" && value.trim() === "") return undefined;
  return value;
}

const optionalUuidSchema = z.preprocess(
  emptyToUndefined,
  z.string().uuid().optional()
);

const optionalTextSchema = z.preprocess(emptyToUndefined, z.string().optional());

const moneySchema = z.preprocess(
  (value) => parseLocaleNumber(value) ?? value,
  z
    .number()
    .min(0, "Harga estimasi tidak boleh negatif")
    .max(MAX_NUMERIC_15_2, "Harga estimasi terlalu besar")
);

const qtySchema = z.preprocess(
  (value) => parseLocaleNumber(value) ?? value,
  z.number().min(1, "Jumlah minimal 1").max(2_147_483_647, "Jumlah terlalu besar")
);

export const prItemSchema = z.object({
  product_id: optionalUuidSchema,
  raw_material_id: z.string().uuid("Bahan baku wajib dipilih"),
  satuan_id: optionalUuidSchema,
  description: z.string().min(1, "Deskripsi barang wajib diisi"),
  qty: qtySchema,
  unit: z.string().min(1, "Satuan wajib diisi"),
  estimated_price: moneySchema,
});

export const productPrItemSchema = z.object({
  product_id: z.string().uuid("Product is required"),
  satuan_id: optionalUuidSchema,
  description: z.string().min(1, "Description is required"),
  qty: qtySchema,
  unit: z.string().min(1, "Unit is required"),
  estimated_price: moneySchema,
});

// EPIC-026 B2 — item PR barang operasional (scope 'general').
export const generalPrItemSchema = z.object({
  supply_item_id: z.string().uuid("Barang operasional wajib dipilih"),
  satuan_id: optionalUuidSchema,
  description: z.string().min(1, "Deskripsi barang wajib diisi"),
  qty: qtySchema,
  unit: z.string().min(1, "Satuan wajib diisi"),
  estimated_price: moneySchema,
});

export const prWriteSchema = z.object({
  department_id: z.string().uuid("Department tidak valid"),
  priority: z.enum(["low", "medium", "high", "urgent"]),
  required_date: optionalTextSchema,
  notes: optionalTextSchema,
  items: z.array(prItemSchema).min(1, "Minimal 1 item"),
  action: z.enum(["draft", "submit"]).optional().default("draft"),
});

export const productPrWriteSchema = z.object({
  department_id: z.string().uuid("Department is invalid"),
  priority: z.enum(["low", "medium", "high", "urgent"]),
  required_date: optionalTextSchema,
  notes: optionalTextSchema,
  items: z.array(productPrItemSchema).min(1, "At least one item is required"),
  action: z.enum(["draft", "submit"]).optional().default("draft"),
});

export const generalPrWriteSchema = z.object({
  department_id: z.string().uuid("Departemen tidak valid"),
  priority: z.enum(["low", "medium", "high", "urgent"]),
  required_date: optionalTextSchema,
  notes: optionalTextSchema,
  items: z.array(generalPrItemSchema).min(1, "Minimal 1 item"),
  action: z.enum(["draft", "submit"]).optional().default("draft"),
});

// Union item PR lintas-scope. Dipakai untuk meng-collapse union-of-arrays
// (hasil parsePrWriteBody 3-arah) menjadi array-of-union sebelum di-normalize +
// insert, supaya TS menerima satu tipe baris, bukan union tiga array.
export type PrWriteItem =
  | z.infer<typeof prItemSchema>
  | z.infer<typeof productPrItemSchema>
  | z.infer<typeof generalPrItemSchema>;

export function parsePrWriteBody(body: unknown, moduleType: PurchasingModuleType = "raw_material") {
  if (moduleType === "product") return parseBodyOrThrow(productPrWriteSchema, body);
  if (moduleType === "general") return parseBodyOrThrow(generalPrWriteSchema, body);
  return parseBodyOrThrow(prWriteSchema, body);
}

export function formatZodError(error: z.ZodError) {
  const first = error.issues[0];
  return first?.message || "Validasi gagal";
}

/**
 * Parse body/query dengan skema zod. Galat → 400
 * `{ success: false, error: <pesan isu pertama>, details: issues }`.
 * Dipakai saat skema dipilih runtime (module_type) atau untuk query string.
 */
export function parseBodyOrThrow<T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw ApiError.badRequest(formatZodError(parsed.error), parsed.error.issues);
  }
  return parsed.data;
}

export function mapPrPgErrorMessage(message: string): string {
  if (message.includes("numeric field overflow")) {
    return "Nilai qty atau harga estimasi terlalu besar. Periksa kembali angka pada item PR.";
  }
  if (message.includes("pr_items_satuan_id_fkey")) {
    return "Satuan pada item PR tidak valid. Pilih ulang satuan bahan baku.";
  }
  if (message.includes("pr_items_raw_material_id_fkey")) {
    return "Bahan baku pada item PR tidak valid.";
  }
  if (message.includes("pr_items_product_id_fkey")) {
    return "Product on PR item is invalid.";
  }
  if (message.includes("pr_items_supply_item_id_fkey")) {
    return "Barang operasional pada item PR tidak valid.";
  }
  if (message.includes("department_id")) {
    return "Departemen tidak valid.";
  }
  if (message.includes("purchase_requests_pr_number_key")) {
    return "Nomor PR bentrok, silakan coba lagi.";
  }
  return message;
}

export function extractPrErrorMessage(error: unknown, fallback = "Gagal membuat PR"): string {
  if (error instanceof Error && error.message) {
    return mapPrPgErrorMessage(error.message);
  }
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) {
      return mapPrPgErrorMessage(message);
    }
  }
  return fallback;
}

export function normalizePrWriteItems<
  T extends { qty: number; estimated_price: number },
>(items: T[]) {
  return items.map((item) => {
    const qty = normalizePrQty(item.qty);
    const estimated_price = clampMoney(item.estimated_price);
    return {
      ...item,
      qty,
      estimated_price,
      total: roundMoney(qty * estimated_price),
    };
  });
}

export function sumPrTotalAmount(items: Array<{ total: number }>) {
  return clampMoney(items.reduce((sum, item) => sum + item.total, 0));
}
