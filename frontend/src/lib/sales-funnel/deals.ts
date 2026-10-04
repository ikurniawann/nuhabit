import { z } from "zod";
import { ApiError } from "@/lib/api/auth";
import { categoryFromStage } from "./forecast";
import { DEAL_EVENT_TYPES } from "./server";

/** Label jenis acara di dokumen (PDF quotation/invoice). */
export const EVENT_TYPE_DOC_LABELS: Record<string, string> = {
  gathering: "Gathering",
  "field-trip": "Field Trip",
  "ulang-tahun": "Ulang Tahun",
  "buyout-venue": "Buyout Venue",
  lainnya: "Acara",
};

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const createDealSchema = z.object({
  lead_id: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
  event_type: z.enum(DEAL_EVENT_TYPES).default("lainnya"),
  event_date: isoDate.optional().nullable().or(z.literal("")),
  is_event_date_fixed: z.boolean().default(false),
  pax_estimate: z.number().int().min(1).max(100000).optional().nullable(),
  value_estimate: z.number().min(0).max(99_999_999_999).optional().nullable(),
  owner_user_id: z.string().uuid().optional().nullable(),
  // EPIC-050 Fase 3
  pipeline_id: z.string().uuid().optional().nullable(),
  custom: z.record(z.string(), z.unknown()).optional(),
});

export const updateDealSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  event_type: z.enum(DEAL_EVENT_TYPES).optional(),
  event_date: isoDate.nullable().optional().or(z.literal("")),
  is_event_date_fixed: z.boolean().optional(),
  pax_estimate: z.number().int().min(1).max(100000).nullable().optional(),
  value_estimate: z.number().min(0).max(99_999_999_999).nullable().optional(),
  value_final: z.number().min(0).max(99_999_999_999).nullable().optional(),
  owner_user_id: z.string().uuid().nullable().optional(),
  stage_id: z.string().uuid().optional(),
  lost_reason_id: z.string().uuid().nullable().optional(),
  // EPIC-050 Fase 3
  forecast_category: z.enum(["pipeline", "best_case", "commit"]).optional(),
  custom: z.record(z.string(), z.unknown()).optional(),
});

export type DealUpdateFields = Omit<z.infer<typeof updateDealSchema>, "custom">;

export interface TargetStage {
  is_won: boolean;
  is_lost: boolean;
  probability: number;
}

/**
 * Aturan pindah tahap (acceptance criteria EPIC-022). Menang wajib nilai
 * final + tanggal acara (tanggal jadi fix, alasan kalah dibuang); Kalah wajib
 * alasan; kembali ke tahap berjalan mereset status tutup & alasan kalah.
 * Kategori forecast mengikuti tahap kecuali di-override manual.
 */
export function planStageMove(
  stage: TargetStage,
  body: DealUpdateFields,
  current: { value_final: string | null; event_date: string | null },
  nowIso: string
): { body: DealUpdateFields; columns: Record<string, unknown> } {
  const next: DealUpdateFields = { ...body };
  const columns: Record<string, unknown> = {};
  if (body.forecast_category === undefined) columns.forecast_category = categoryFromStage(stage);

  if (stage.is_won) {
    const finalValue = body.value_final !== undefined ? body.value_final : current.value_final;
    const eventDate = body.event_date !== undefined ? body.event_date : current.event_date;
    if (finalValue === null || finalValue === undefined) {
      throw ApiError.badRequest("Deal Menang wajib diisi nilai final");
    }
    if (!eventDate) throw ApiError.badRequest("Deal Menang wajib punya tanggal acara fix");
    next.is_event_date_fixed = true;
    next.lost_reason_id = null;
    columns.closed_at = nowIso;
  } else if (stage.is_lost) {
    if (!body.lost_reason_id) throw ApiError.badRequest("Deal Kalah wajib pilih alasan kalah");
    columns.closed_at = nowIso;
  } else {
    next.lost_reason_id = null;
    columns.closed_at = null;
  }
  columns.entered_stage_at = nowIso;
  return { body: next, columns };
}
