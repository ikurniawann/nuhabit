import "server-only";
/**
 * EPIC-050 Fase 3 (T-3.3) — custom fields, sisi server: muat definisi aktif
 * (global + company) dan validasi payload `custom` sebelum tulis.
 */
import { NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";
import {
  mergeCustomValues,
  validateCustomValues,
  type CustomFieldDef,
  type CustomFieldObject,
  type CustomValues,
} from "./custom-fields";

export async function loadCustomFieldDefs(object: CustomFieldObject, companyId: string | null): Promise<CustomFieldDef[]> {
  return query<CustomFieldDef>(
    `SELECT id, object, key, label, field_type, options, is_required, validation, help_text, show_in_list, sort_order
     FROM crm.crm_custom_fields
     WHERE is_active AND object = $1 AND (company_id IS NULL OR company_id = $2)
     ORDER BY sort_order, created_at`,
    [object, companyId]
  );
}

/**
 * Validasi `custom` dari body. Mengembalikan nilai ternormalisasi (untuk
 * disimpan) atau NextResponse 400. `existing` = nilai lama saat PATCH (merge).
 */
export async function validateCustomPayload(
  object: CustomFieldObject,
  companyId: string | null,
  raw: CustomValues | null | undefined,
  existing?: CustomValues | null
): Promise<{ values: CustomValues; error: null } | { values: null; error: NextResponse }> {
  const defs = await loadCustomFieldDefs(object, companyId);
  const partial = existing !== undefined;
  const result = validateCustomValues(defs, raw, { partial });
  if (!result.ok) {
    return {
      values: null,
      error: NextResponse.json(
        { success: false, error: result.errors.map((e) => e.message).join("; "), details: result.errors },
        { status: 400 }
      ),
    };
  }
  return { values: partial ? mergeCustomValues(existing, result.values) : result.values, error: null };
}

export async function loadExistingCustom(table: string, id: string): Promise<CustomValues> {
  const row = await queryOne<{ custom: CustomValues | null }>(`SELECT custom FROM ${table} WHERE id = $1`, [id]);
  return row?.custom ?? {};
}
