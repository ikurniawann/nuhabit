/**
 * EPIC-050 Fase 3 (T-3.3) — custom fields, bagian murni.
 * Registry di crm.crm_custom_fields; nilai disimpan di kolom `custom` jsonb
 * tiap objek (lead/deal/account/contact). Validasi server memakai
 * validateCustomValues() sebelum insert/update.
 */
import { z } from "zod";
import { formatDate, formatNumber } from "@/lib/format";

export const CUSTOM_FIELD_OBJECTS = ["lead", "deal", "account", "contact"] as const;
export type CustomFieldObject = (typeof CUSTOM_FIELD_OBJECTS)[number];

export const CUSTOM_FIELD_TYPES = [
  "text",
  "textarea",
  "number",
  "date",
  "boolean",
  "picklist",
  "multipicklist",
  "url",
  "email",
  "phone",
] as const;
export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number];

export const customFieldSchema = z
  .object({
    object: z.enum(CUSTOM_FIELD_OBJECTS),
    key: z.string().trim().regex(/^[a-z][a-z0-9_]{1,39}$/, "key: huruf kecil, angka, underscore; diawali huruf"),
    label: z.string().trim().min(1).max(100),
    field_type: z.enum(CUSTOM_FIELD_TYPES),
    options: z.array(z.string().trim().min(1).max(100)).max(100).default([]),
    is_required: z.boolean().default(false),
    validation: z
      .object({
        min: z.number().optional(),
        max: z.number().optional(),
        min_length: z.number().int().min(0).optional(),
        max_length: z.number().int().min(1).optional(),
        pattern: z.string().max(200).optional(),
      })
      .default({}),
    help_text: z.string().trim().max(200).optional().nullable(),
    show_in_list: z.boolean().default(false),
    sort_order: z.number().int().default(0),
    is_active: z.boolean().default(true),
  })
  .refine((f) => !["picklist", "multipicklist"].includes(f.field_type) || f.options.length > 0, {
    message: "Picklist wajib punya minimal satu pilihan",
  });
export type CustomFieldInput = z.infer<typeof customFieldSchema>;

export interface CustomFieldDef {
  id: string;
  object: CustomFieldObject;
  key: string;
  label: string;
  field_type: CustomFieldType;
  options: string[];
  is_required: boolean;
  validation: { min?: number; max?: number; min_length?: number; max_length?: number; pattern?: string };
  help_text?: string | null;
  show_in_list?: boolean;
  sort_order?: number;
}

export type CustomValues = Record<string, unknown>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_RE = /^https?:\/\/\S+$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Angka format Indonesia/Inggris: "25.000.000" → 25000000, "1.500,50" → 1500.5,
 * "1,5" → 1.5, "1.5" → 1.5, "1500" → 1500.
 */
export function parseLocaleNumber(raw: string): number {
  const s = raw.trim().replace(/\s/g, "");
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) return Number(s.replace(/\./g, "").replace(",", "."));
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) return Number(s.replace(/,/g, ""));
  return Number(s.replace(",", "."));
}

function isEmpty(v: unknown): boolean {
  return v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
}

/**
 * Validasi + normalisasi nilai custom terhadap definisi field.
 * - Kunci yang tidak terdaftar dibuang (tidak error) — melindungi dari klien lama.
 * - Mengembalikan nilai ternormalisasi (number → number, boolean → boolean, dsb.).
 */
export function validateCustomValues(
  defs: CustomFieldDef[],
  raw: CustomValues | null | undefined,
  { partial = false }: { partial?: boolean } = {}
): { ok: true; values: CustomValues } | { ok: false; errors: Array<{ key: string; message: string }> } {
  const input = raw ?? {};
  const values: CustomValues = {};
  const errors: Array<{ key: string; message: string }> = [];
  for (const def of defs) {
    const has = Object.prototype.hasOwnProperty.call(input, def.key);
    const v = input[def.key];
    if (isEmpty(v)) {
      if (def.is_required && (!partial || has)) errors.push({ key: def.key, message: `${def.label} wajib diisi` });
      if (has) values[def.key] = null;
      continue;
    }
    const val = def.validation ?? {};
    switch (def.field_type) {
      case "number": {
        const n = typeof v === "number" ? v : parseLocaleNumber(String(v));
        if (!Number.isFinite(n)) { errors.push({ key: def.key, message: `${def.label} harus angka` }); break; }
        if (val.min !== undefined && n < val.min) errors.push({ key: def.key, message: `${def.label} minimal ${val.min}` });
        if (val.max !== undefined && n > val.max) errors.push({ key: def.key, message: `${def.label} maksimal ${val.max}` });
        values[def.key] = n;
        break;
      }
      case "boolean":
        values[def.key] = v === true || v === "true" || v === 1 || v === "1";
        break;
      case "date": {
        const s = String(v);
        if (!DATE_RE.test(s) || Number.isNaN(Date.parse(s))) { errors.push({ key: def.key, message: `${def.label} harus tanggal YYYY-MM-DD` }); break; }
        values[def.key] = s;
        break;
      }
      case "picklist": {
        const s = String(v);
        if (!def.options.includes(s)) { errors.push({ key: def.key, message: `${def.label} harus salah satu dari pilihan` }); break; }
        values[def.key] = s;
        break;
      }
      case "multipicklist": {
        const arr = Array.isArray(v) ? v.map(String) : String(v).split(",").map((x) => x.trim()).filter(Boolean);
        const bad = arr.filter((x) => !def.options.includes(x));
        if (bad.length) { errors.push({ key: def.key, message: `${def.label}: pilihan tidak dikenal (${bad.join(", ")})` }); break; }
        values[def.key] = arr;
        break;
      }
      case "email": {
        const s = String(v).trim();
        if (!EMAIL_RE.test(s)) { errors.push({ key: def.key, message: `${def.label} bukan email valid` }); break; }
        values[def.key] = s;
        break;
      }
      case "url": {
        const s = String(v).trim();
        if (!URL_RE.test(s)) { errors.push({ key: def.key, message: `${def.label} harus diawali http:// atau https://` }); break; }
        values[def.key] = s;
        break;
      }
      case "phone": {
        const digits = String(v).replace(/[^0-9+]/g, "");
        if (digits.replace(/\D/g, "").length < 8) { errors.push({ key: def.key, message: `${def.label} nomor terlalu pendek` }); break; }
        values[def.key] = digits;
        break;
      }
      default: {
        const s = String(v);
        if (val.min_length !== undefined && s.length < val.min_length) errors.push({ key: def.key, message: `${def.label} minimal ${val.min_length} karakter` });
        if (val.max_length !== undefined && s.length > val.max_length) errors.push({ key: def.key, message: `${def.label} maksimal ${val.max_length} karakter` });
        if (val.pattern) {
          try {
            if (!new RegExp(val.pattern).test(s)) errors.push({ key: def.key, message: `${def.label} tidak sesuai format` });
          } catch {
            // pola tidak valid → abaikan pola
          }
        }
        values[def.key] = s;
      }
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true, values };
}

/** Gabungkan nilai lama + nilai baru (PATCH) — kunci tak terdaftar di nilai lama dipertahankan. */
export function mergeCustomValues(existing: CustomValues | null | undefined, incoming: CustomValues): CustomValues {
  return { ...(existing ?? {}), ...incoming };
}

/** Format nilai untuk tampilan tabel/detail. */
export function formatCustomValue(def: CustomFieldDef, v: unknown): string {
  if (isEmpty(v)) return "—";
  switch (def.field_type) {
    case "boolean":
      return v ? "Ya" : "Tidak";
    case "multipicklist":
      return Array.isArray(v) ? v.join(", ") : String(v);
    case "number":
      return formatNumber(Number(v), 3);
    case "date":
      return formatDate(String(v));
    default:
      return String(v);
  }
}
