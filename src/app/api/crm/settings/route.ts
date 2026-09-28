import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getPosSession, getApiUser } from "@/lib/api/auth";
import { createPgClient } from "@/lib/pg/create-client";
import {
  apiErrorResponse,
  isMissingCrmSchema,
  requireCrmConfigRole,
  validationErrorResponse,
} from "@/lib/crm/server";

/**
 * Konfigurasi CRM yang boleh diubah Super Admin dari UI.
 * - Loyalty (EPIC-011 Fase B): bonus topup, Free XP.
 * - Saklar fitur (2026-09-28): ARK Coin & XP — lihat lib/crm/loyalty-features.
 * - Customer service (EPIC-012 Fase D): SLA, jam operasional, auto-reply, CSAT.
 */
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

const updateSchema = z
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

export async function GET() {
  const sessionUserId = await getPosSession();
  if (!sessionUserId) {
    return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 });
  }

  try {
    const db = createPgClient();
    const { data, error } = await db
      .from("crm_settings")
      .select("key, value, description, updated_at")
      .in("key", [...EDITABLE_KEYS]);

    if (error) {
      if (isMissingCrmSchema(error)) {
        return NextResponse.json({ success: true, data: {}, meta: { schemaReady: false } });
      }
      throw error;
    }

    // value bertipe jsonb — angka/boolean/teks dikembalikan apa adanya, bukan
    // dipaksa jadi angka (teks auto-reply akan jadi NaN bila dipaksa).
    const settings = Object.fromEntries(
      ((data ?? []) as Array<{ key: string; value: unknown }>).map((row) => [row.key, row.value])
    );

    return NextResponse.json({ success: true, data: settings, meta: { schemaReady: true } });
  } catch (error) {
    console.error("Error fetching CRM settings:", error);
    return apiErrorResponse(error);
  }
}

export async function PUT(request: NextRequest) {
  const forbidden = await requireCrmConfigRole();
  if (forbidden) return forbidden;

  try {
    const payload = updateSchema.parse(await request.json());
    const user = await getApiUser();
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
          updated_by: user?.id ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq("key", key);

      if (error) {
        if (isMissingCrmSchema(error)) {
          return NextResponse.json(
            { success: false, error: "CRM migration belum diterapkan" },
            { status: 409 }
          );
        }
        throw error;
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    const validation = validationErrorResponse(error);
    if (validation) return validation;

    console.error("Error updating CRM settings:", error);
    return apiErrorResponse(error);
  }
}
