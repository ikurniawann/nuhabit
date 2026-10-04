/**
 * Aturan murni campaign & kode promo: pembuatan kode unik berulang, prefix
 * voucher, dan rencana UPDATE campaign (siapa boleh diubah kapan).
 */
import { ApiError } from "@/lib/api/auth";
import type { CampaignPatch } from "./campaign-schema";

/**
 * Isi `need` kode unik: tiap ronde membuat kandidat baru lalu `insert`
 * mengembalikan yang benar-benar masuk (tabrakan di-skip ON CONFLICT).
 * Maks `rounds` ronde; kurang dari `need` → ApiError dengan pesan `shortMessage`.
 */
export async function fillUniqueCodes<T>(input: {
  need: number;
  generate: () => string;
  insert: (candidates: string[]) => Promise<T[]>;
  shortMessage: (created: number, need: number) => string;
  rounds?: number;
}): Promise<T[]> {
  const created: T[] = [];
  for (let round = 0; round < (input.rounds ?? 6) && created.length < input.need; round++) {
    const candidates = new Set<string>();
    while (candidates.size < input.need - created.length) candidates.add(input.generate());
    created.push(...(await input.insert([...candidates])));
  }
  if (created.length < input.need) throw ApiError.server(input.shortMessage(created.length, input.need));
  return created;
}

/** Prefix voucher dari kode lama `PREFIX-XXXXXX`; null bila tidak ada pola itu. */
export function inferPrefix(codes: readonly string[]): string | null {
  for (const code of codes) {
    const match = /^([A-Z0-9]{2,12})-/.exec(code.toUpperCase());
    if (match) return match[1];
  }
  return null;
}

// Saklar yang selalu boleh diubah, juga setelah ada voucher terpakai.
const TOGGLE_KEYS = new Set(["is_active", "show_in_member_portal"]);

export interface CampaignSnapshot {
  discount_type: string;
  value: string | number;
  valid_from: string | null;
  valid_until: string | null;
  captured_count: string | number;
}

/**
 * Daftar `kolom = nilai` untuk PATCH campaign. Aturan: hanya saklar aktif
 * yang boleh diubah setelah ada voucher terpakai; diskon persen ≤ 100;
 * rentang tanggal akhir tidak sebelum mulai; max_discount hanya untuk persen;
 * new_member_days hanya untuk kelayakan member_baru.
 */
export function planCampaignUpdate(body: CampaignPatch, current: CampaignSnapshot): [string, unknown][] {
  const keys = Object.keys(body);
  const onlyToggles = keys.length > 0 && keys.every((key) => TOGGLE_KEYS.has(key));
  if (!onlyToggles && (Number(current.captured_count) || 0) > 0) {
    throw ApiError.conflict("Campaign sudah punya voucher terpakai — hanya status aktif yang boleh diubah");
  }

  const finalType = body.discount_type ?? current.discount_type;
  const finalValue = body.value ?? Number(current.value);
  if (finalType === "percent" && finalValue > 100) throw ApiError.badRequest("Diskon persen maksimal 100");
  const finalFrom = body.valid_from !== undefined ? body.valid_from : current.valid_from;
  const finalUntil = body.valid_until !== undefined ? body.valid_until : current.valid_until;
  if (finalFrom && finalUntil && finalUntil < finalFrom) {
    throw ApiError.badRequest("Tanggal akhir sebelum tanggal mulai");
  }

  const columns: [string, unknown][] = [];
  const add = (column: string, value: unknown) => columns.push([column, value]);
  if (body.name !== undefined) add("name", body.name);
  if (body.description !== undefined) add("description", body.description);
  if (body.discount_type !== undefined) add("discount_type", body.discount_type);
  if (body.value !== undefined) add("value", body.value);
  if (body.max_discount !== undefined) add("max_discount", finalType === "percent" ? body.max_discount : null);
  else if (body.discount_type === "fixed") add("max_discount", null);
  if (body.min_purchase !== undefined) add("min_purchase", body.min_purchase);
  if (body.valid_from !== undefined) add("valid_from", body.valid_from);
  if (body.valid_until !== undefined) add("valid_until", body.valid_until);
  if (body.usage_limit !== undefined) add("usage_limit", body.usage_limit);
  if (body.per_phone_limit !== undefined) add("per_phone_limit", body.per_phone_limit);
  if (body.scope !== undefined) add("scope", body.scope);
  if (body.target_product_ids !== undefined) add("target_product_ids", body.target_product_ids);
  if (body.target_category_ids !== undefined) add("target_category_ids", body.target_category_ids);
  if (body.eligibility !== undefined) {
    add("eligibility", body.eligibility);
    add("new_member_days", body.eligibility === "member_baru" ? (body.new_member_days ?? null) : null);
  } else if (body.new_member_days !== undefined) {
    add("new_member_days", body.new_member_days);
  }
  if (body.is_active !== undefined) add("is_active", body.is_active);
  if (body.show_in_member_portal !== undefined) add("show_in_member_portal", body.show_in_member_portal);
  return columns;
}
