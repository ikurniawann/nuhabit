/**
 * Target KPI (EPIC-010 Fase D). Scope eksklusif: karyawan, department, role,
 * atau umum; periode opsional (bulan-eksak / tahun / berlaku umum).
 * Resolusi target saat snapshot ada di targets.ts.
 */

import { z } from "zod";
import { ApiError } from "@/lib/api/auth";
import { unwrap } from "@/lib/hris/workforce-route";
import type { PgClient } from "@/lib/pg/create-client";

const TARGET_REQUIRED = "indicator_id dan target (angka ≥ 0) wajib";
const PERIOD_INVALID = "Periode tidak valid";

export const createTargetSchema = z
  .object({
    indicator_id: z.string({ error: TARGET_REQUIRED }).min(1, TARGET_REQUIRED),
    target: z.coerce.number({ error: TARGET_REQUIRED }).min(0, TARGET_REQUIRED),
    period_year: z.coerce.number({ error: PERIOD_INVALID }).int(PERIOD_INVALID).nullish(),
    period_month: z.coerce
      .number({ error: PERIOD_INVALID })
      .int(PERIOD_INVALID)
      .min(1, PERIOD_INVALID)
      .max(12, PERIOD_INVALID)
      .nullish(),
    role_code: z.string().nullish(),
    department_id: z.string().nullish(),
    employee_id: z.string().nullish(),
  })
  .refine((t) => [t.role_code, t.department_id, t.employee_id].filter(Boolean).length <= 1, {
    message: "Pilih satu scope saja (role ATAU department ATAU karyawan)",
  });

export async function listTargets(db: PgClient) {
  return unwrap(
    await db
      .from("kpi_targets")
      .select(
        `*, indicator:kpi_indicators ( code, name, unit, direction ),
         department:departments ( id, name ),
         employee:employees ( id, full_name, nip )`
      )
      .order("created_at", { ascending: false })
      .limit(500)
  );
}

export async function createTarget(
  db: PgClient,
  userId: string,
  input: z.infer<typeof createTargetSchema>
) {
  const { data, error } = await db
    .from("kpi_targets")
    .insert({
      indicator_id: input.indicator_id,
      period_year: input.period_year ?? null,
      period_month: input.period_month ?? null,
      role_code: input.role_code || null,
      department_id: input.department_id || null,
      employee_id: input.employee_id || null,
      target: input.target,
      created_by: userId,
    })
    .select("*")
    .single();
  // FK tidak valid (indikator/dept/karyawan tak ada) → 400 yang jelas
  if (error?.code === "23503") {
    throw ApiError.badRequest("Indikator/department/karyawan tidak ditemukan");
  }
  return unwrap({ data, error });
}

export async function deleteTarget(db: PgClient, id: string) {
  unwrap(await db.from("kpi_targets").delete().eq("id", id));
}
