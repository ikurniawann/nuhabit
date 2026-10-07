import "server-only";
/**
 * Konfigurasi CRM yang boleh diubah Super Admin dari UI (crm_settings, jsonb).
 * - Loyalty (EPIC-011 Fase B): bonus topup, Free XP.
 * - Saklar fitur (2026-09-28): ARK Coin & XP — lihat lib/crm/loyalty-features.
 * - Customer service (EPIC-012 Fase D): SLA, jam operasional, auto-reply, CSAT.
 */
import { z } from "zod";
import { createPgClient } from "@/lib/pg/create-client";
import { crmSchemaError } from "./guards";
import { isMissingCrmSchema } from "./server";

const EDITABLE_KEYS = [
  "ark_coin_enabled",
  "xp_enabled",
  "topup_bonus_percent",
  "profile_completion_free_xp",
  "cs_sla_response_minutes",
  "cs_sla_resolution_minutes",
  "cs_business_hours_start",
  "cs_business_hours_end",
  "cs_auto_reply_enabled",
  "cs_auto_reply_text",
  "cs_csat_enabled",
  "cs_csat_text",
] as const;

export const crmSettingsUpdateSchema = z
  .object({
    ark_coin_enabled: z.boolean().optional(),
    xp_enabled: z.boolean().optional(),
    topup_bonus_percent: z.number().min(0).max(100).optional(),
    profile_completion_free_xp: z.number().int().min(0).optional(),
    cs_sla_response_minutes: z.number().int().min(1).max(1440).optional(),
    cs_sla_resolution_minutes: z.number().int().min(1).max(10080).optional(),
    // Jam 0-23; start == end berarti buka 24 jam.
    cs_business_hours_start: z.number().int().min(0).max(23).optional(),
    cs_business_hours_end: z.number().int().min(0).max(23).optional(),
    cs_auto_reply_enabled: z.boolean().optional(),
    cs_auto_reply_text: z.string().trim().min(1).max(1000).optional(),
    cs_csat_enabled: z.boolean().optional(),
    cs_csat_text: z.string().trim().min(1).max(1000).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Minimal satu setting harus diisi",
  });

/** Setting yang bisa disunting; null bila skema CRM belum siap. */
export async function readCrmSettings(): Promise<Record<string, unknown> | null> {
  const { data, error } = await createPgClient()
    .from("crm_settings")
    .select("key, value, description, updated_at")
    .in("key", [...EDITABLE_KEYS]);

  if (error) {
    if (isMissingCrmSchema(error)) return null;
    throw error;
  }
  // value bertipe jsonb — angka/boolean/teks dikembalikan apa adanya, bukan
  // dipaksa jadi angka (teks auto-reply akan jadi NaN bila dipaksa).
  return Object.fromEntries(
    ((data ?? []) as Array<{ key: string; value: unknown }>).map((row) => [row.key, row.value])
  );
}

export async function updateCrmSettings(
  payload: z.infer<typeof crmSettingsUpdateSchema>,
  userId: string | null
): Promise<void> {
  const db = createPgClient();
  for (const key of EDITABLE_KEYS) {
    const value = payload[key];
    if (value === undefined) continue;

    const { error } = await db
      .from("crm_settings")
      .update({
        // Kolom jsonb: nilai HARUS diserialisasi JSON. Teks mentah akan
        // ditolak Postgres karena bukan JSON valid (pelajaran benefits tier).
        value: JSON.stringify(value),
        updated_by: userId,
        updated_at: new Date().toISOString(),
      })
      .eq("key", key);

    if (error) throw crmSchemaError(error);
  }
}
