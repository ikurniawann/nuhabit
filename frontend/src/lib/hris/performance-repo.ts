/**
 * Performance Review kuartalan (owner 2026-08-31, Fase 1): siklus, daftar
 * review ber-scope, laporan KPI berjalan, detail, dan aksi bertahap
 * (self assessment → penilaian perilaku → catatan reviewer → tanda tangan →
 * finalisasi HRD). Lingkup per peran: HRD semua, Head Division (punya bawahan
 * langsung) departemennya, karyawan lain dirinya sendiri.
 */

import { z } from "zod";
import { ApiError } from "@/lib/api/auth";
import { query, queryOne, withTransaction } from "@/lib/db";
import { quarterLabel, quarterMonths, quarterRange, recalcReview } from "./performance-review";
import type { WorkforceActor } from "./workforce-auth";
import { UUID_RE } from "./workforce-route";

// ── Lingkup aktor ───────────────────────────────────────────────────────

interface ActorDepartment {
  departmentId: string | null;
  /** Punya bawahan langsung aktif dan departemen. */
  isHead: boolean;
}

async function loadActorDepartment(actor: WorkforceActor): Promise<ActorDepartment> {
  if (!actor.employeeId) return { departmentId: null, isHead: false };
  const me = await queryOne<{ department_id: string | null; subordinates: number }>(
    `SELECT e.department_id,
            (SELECT count(*) FROM hris.employees s
             WHERE s.reporting_to = e.id AND s.is_active)::int AS subordinates
     FROM hris.employees e WHERE e.id = $1`,
    [actor.employeeId]
  );
  const departmentId = me?.department_id ?? null;
  return { departmentId, isHead: (me?.subordinates ?? 0) > 0 && !!departmentId };
}

async function employeeName(employeeId: string | null, fallback: string): Promise<string> {
  if (!employeeId) return fallback;
  const row = await queryOne<{ full_name: string }>(
    `SELECT full_name FROM hris.employees WHERE id = $1`,
    [employeeId]
  );
  return row?.full_name ?? fallback;
}

// ── Siklus ──────────────────────────────────────────────────────────────

export const openCycleSchema = z.object({
  period_year: z.coerce
    .number({ error: "Tahun tidak valid" })
    .int("Tahun tidak valid")
    .min(2020, "Tahun tidak valid")
    .max(2100, "Tahun tidak valid"),
  period_quarter: z.coerce
    .number({ error: "Kuartal harus 1–4" })
    .int("Kuartal harus 1–4")
    .min(1, "Kuartal harus 1–4")
    .max(4, "Kuartal harus 1–4"),
});

export function listCycles() {
  return query(
    `SELECT c.id, c.name, c.period_year, c.period_quarter,
            c.start_date::text, c.end_date::text, c.status, c.created_by_name,
            count(r.id)::int AS total_reviews,
            count(r.id) FILTER (WHERE r.status = 'final')::int AS final_reviews,
            count(r.id) FILTER (WHERE r.total_behavioral_score > 0)::int AS rated_reviews
     FROM performance.review_cycles c
     LEFT JOIN performance.performance_reviews r ON r.cycle_id = c.id
     GROUP BY c.id
     ORDER BY c.period_year DESC, c.period_quarter DESC`
  );
}

/**
 * HRD membuka siklus: draft review untuk semua karyawan aktif + snapshot
 * standar perilaku aktif (disalin per review agar perubahan standar tidak
 * mengubah review berjalan), lalu Hasil Kerja diisi dari rata-rata KPI.
 */
export async function openCycle(actor: WorkforceActor, input: z.infer<typeof openCycleSchema>) {
  if (!actor.isHr) throw ApiError.forbidden("Hanya HRD yang boleh membuka siklus review");
  const { period_year: year, period_quarter: quarter } = input;
  const label = quarterLabel(year, quarter);

  const exists = await queryOne<{ id: string }>(
    `SELECT id FROM performance.review_cycles WHERE period_year = $1 AND period_quarter = $2`,
    [year, quarter]
  );
  if (exists) throw ApiError.conflict(`Siklus ${label} sudah ada`);

  const creatorName = await employeeName(actor.employeeId, "HRD");
  const { start, end } = quarterRange(year, quarter);

  const reviewIds = await withTransaction(async (client) => {
    const cycle = await client.query<{ id: string }>(
      `INSERT INTO performance.review_cycles
         (name, period_year, period_quarter, start_date, end_date, created_by_name)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [label, year, quarter, start, end, creatorName]
    );
    const cycleId = cycle.rows[0].id;
    const created = await client.query<{ id: string }>(
      `INSERT INTO performance.performance_reviews
         (cycle_id, employee_id, employee_department_id,
          period_label, start_date, end_date, status)
       SELECT $1, e.id, e.department_id, $2, $3, $4, 'draft'
       FROM hris.employees e WHERE e.is_active = true
       RETURNING id`,
      [cycleId, label, start, end]
    );
    await client.query(
      `INSERT INTO performance.behavioral_review_items
         (review_id, employee_id, value_name, competency, behavioral_standard,
          score_1_description, score_2_description, score_3_description,
          score_4_description, score_5_description, weight, item_order)
       SELECT r.id, r.employee_id, s.value_name, s.competency_name,
              s.standard_description, s.score_1_description, s.score_2_description,
              s.score_3_description, s.score_4_description, s.score_5_description,
              s.weight, row_number() OVER (PARTITION BY r.id ORDER BY s.created_at)
       FROM performance.performance_reviews r
       JOIN performance.behavioral_standards s ON s.is_active = true
       WHERE r.cycle_id = $1`,
      [cycleId]
    );
    return created.rows.map((row) => row.id);
  });

  // Prefill Hasil Kerja dari KPI kuartal (di luar transaksi; idempoten)
  for (const reviewId of reviewIds) await recalcReview(reviewId);

  return {
    message: `Siklus ${label} dibuka — ${reviewIds.length} draft review dibuat`,
    data: { review_count: reviewIds.length },
  };
}

// ── Daftar review & laporan berjalan ────────────────────────────────────

export const reviewListQuerySchema = z.object({
  cycle_id: z.string({ error: "Parameter cycle_id wajib" }).regex(UUID_RE, "Parameter cycle_id wajib"),
});

export async function listReviews(actor: WorkforceActor, cycleId: string) {
  const { departmentId, isHead } = await loadActorDepartment(actor);
  let where = "";
  const params: unknown[] = [cycleId];
  if (!actor.isHr) {
    if (isHead) {
      params.push(departmentId, actor.employeeId);
      where = `AND (r.employee_department_id = $2 OR r.employee_id = $3)`;
    } else if (actor.employeeId) {
      params.push(actor.employeeId);
      where = `AND r.employee_id = $2`;
    } else {
      return { reviews: [], can_review: false };
    }
  }

  const reviews = await query(
    `SELECT r.id, r.employee_id, e.full_name, e.nip, d.name AS department_name,
            r.status, r.total_work_result_score, r.total_behavioral_score,
            r.total_project_score, r.grand_total_score, r.category,
            r.employee_sign_date::text, r.reviewer_sign_date::text,
            r.reviewer_name,
            (r.self_assessment IS NOT NULL) AS self_done,
            (SELECT count(*) FROM performance.behavioral_review_items i
             WHERE i.review_id = r.id AND i.score IS NOT NULL)::int AS rated_items,
            (SELECT count(*) FROM performance.behavioral_review_items i
             WHERE i.review_id = r.id)::int AS total_items
     FROM performance.performance_reviews r
     JOIN hris.employees e ON e.id = r.employee_id
     LEFT JOIN hris.departments d ON d.id = r.employee_department_id
     WHERE r.cycle_id = $1 ${where}
     ORDER BY d.name NULLS LAST, e.full_name`,
    params
  );
  return {
    reviews,
    can_review: actor.isHr || isHead,
    is_hr: actor.isHr,
    my_employee_id: actor.employeeId,
  };
}

export const realtimeQuerySchema = z.object({
  year: z.coerce.number().optional(),
  quarter: z.coerce.number().optional(),
});

/** Rata-rata KPI quarter-to-date per karyawan + skor per bulan (sebelum siklus dibuka). */
export async function realtimeKpi(actor: WorkforceActor, year: number, quarter: number) {
  if (year < 2020 || year > 2100 || quarter < 1 || quarter > 4) {
    throw ApiError.badRequest("Periode tidak valid");
  }
  const months = quarterMonths(quarter);
  const { departmentId, isHead } = await loadActorDepartment(actor);

  let where = "e.is_active = true";
  const params: unknown[] = [year, months];
  if (!actor.isHr) {
    if (isHead) {
      params.push(departmentId);
      where += ` AND e.department_id = $3`;
    } else if (actor.employeeId) {
      params.push(actor.employeeId);
      where += ` AND e.id = $3`;
    } else {
      return { employees: [], year, quarter, months, is_hr: false, my_employee_id: null };
    }
  }

  const employees = await query(
    `SELECT e.id, e.full_name, d.name AS department_name,
            AVG(s.score)::numeric(6,2) AS avg_score,
            json_agg(
              json_build_object('month', s.period_month, 'score', s.score, 'status', s.status)
              ORDER BY s.period_month
            ) FILTER (WHERE s.id IS NOT NULL) AS months
     FROM hris.employees e
     LEFT JOIN hris.departments d ON d.id = e.department_id
     LEFT JOIN performance.kpi_scorecards s
       ON s.employee_id = e.id AND s.period_year = $1
      AND s.period_month = ANY($2::int[])
     WHERE ${where}
     GROUP BY e.id, e.full_name, d.name
     ORDER BY AVG(s.score) DESC NULLS LAST, e.full_name`,
    params
  );
  return { employees, year, quarter, months, is_hr: actor.isHr, my_employee_id: actor.employeeId };
}

// ── Detail & aksi satu review ───────────────────────────────────────────

interface ReviewRow {
  id: string;
  employee_id: string;
  employee_department_id: string | null;
  status: string;
  period_year: number;
  period_quarter: number;
}

interface ReviewAccess {
  review: ReviewRow;
  isOwner: boolean;
  /** Head Division departemen review ini. */
  isHead: boolean;
}

async function loadReviewAccess(actor: WorkforceActor, id: string): Promise<ReviewAccess> {
  const review = await queryOne<ReviewRow>(
    `SELECT r.id, r.employee_id, r.employee_department_id, r.status,
            c.period_year, c.period_quarter
     FROM performance.performance_reviews r
     JOIN performance.review_cycles c ON c.id = r.cycle_id
     WHERE r.id = $1`,
    [id]
  );
  if (!review) throw ApiError.notFound("Review tidak ditemukan");

  let isHead = false;
  if (actor.employeeId && review.employee_department_id) {
    const head = await queryOne<{ ok: boolean }>(
      `SELECT (e.department_id = $2 AND EXISTS (
         SELECT 1 FROM hris.employees s WHERE s.reporting_to = e.id AND s.is_active
       )) AS ok
       FROM hris.employees e WHERE e.id = $1 AND e.is_active`,
      [actor.employeeId, review.employee_department_id]
    );
    isHead = head?.ok === true;
  }
  return { review, isHead, isOwner: actor.employeeId === review.employee_id };
}

export async function getReviewDetail(actor: WorkforceActor, id: string) {
  const { review, isHead, isOwner } = await loadReviewAccess(actor, id);
  if (!actor.isHr && !isHead && !isOwner) {
    throw ApiError.forbidden("Tidak berhak melihat review ini");
  }

  const months = quarterMonths(Number(review.period_quarter));
  const [detail, items, kpiMonths] = await Promise.all([
    queryOne(
      `SELECT r.*, r.start_date::text AS start_date, r.end_date::text AS end_date,
              r.reviewee_sign_date::text AS reviewee_sign_date,
              r.reviewer_sign_date::text AS reviewer_sign_date,
              r.employee_sign_date::text AS employee_sign_date,
              e.full_name, e.nip, d.name AS department_name, c.name AS cycle_name,
              c.status AS cycle_status
       FROM performance.performance_reviews r
       JOIN hris.employees e ON e.id = r.employee_id
       LEFT JOIN hris.departments d ON d.id = r.employee_department_id
       JOIN performance.review_cycles c ON c.id = r.cycle_id
       WHERE r.id = $1`,
      [id]
    ),
    query(
      `SELECT id, value_name, competency, behavioral_standard,
              score_1_description, score_2_description, score_3_description,
              score_4_description, score_5_description, weight, score, notes, item_order
       FROM performance.behavioral_review_items
       WHERE review_id = $1 ORDER BY item_order, value_name`,
      [id]
    ),
    query(
      `SELECT period_month, score, status
       FROM performance.kpi_scorecards
       WHERE employee_id = $1 AND period_year = $2 AND period_month = ANY($3::int[])
       ORDER BY period_month`,
      [review.employee_id, review.period_year, months]
    ),
  ]);

  return {
    review: detail,
    items,
    kpi_months: kpiMonths,
    can_rate: actor.isHr || isHead,
    can_finalize: actor.isHr,
    is_owner: isOwner,
  };
}

export const reviewActionSchema = z.object({
  action: z.string().optional(),
  text: z.string().nullish(),
  item_id: z.string().optional(),
  score: z.unknown().optional(),
  notes: z.string().nullish(),
  project_score: z.unknown().optional(),
});

type ReviewAction = z.infer<typeof reviewActionSchema>;

/** Nilai kontribusi proyek 0–100; kosong → null. */
export function parseProjectScore(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  const score = Number(raw);
  if (!Number.isFinite(score) || score < 0 || score > 100) {
    throw ApiError.badRequest("Nilai kontribusi harus 0–100");
  }
  return score;
}

/** Skor perilaku wajib bilangan bulat 1–5. */
export function parseBehaviorScore(raw: unknown): number {
  const score = Number(raw);
  if (!Number.isInteger(score) || score < 1 || score > 5) throw ApiError.badRequest("Skor harus 1–5");
  return score;
}

const trimOrNull = (text: string | null | undefined) => String(text ?? "").trim() || null;

/** Jalankan satu aksi; setelah final semua isian terkunci kecuali tanda tangan. */
export async function applyReviewAction(actor: WorkforceActor, id: string, input: ReviewAction) {
  const { review, isHead, isOwner } = await loadReviewAccess(actor, id);
  if (review.status === "final" && input.action !== "sign") {
    throw ApiError.badRequest("Review sudah final — tidak bisa diubah");
  }
  const canRate = actor.isHr || isHead;
  const myName = actor.employeeId ? await employeeName(actor.employeeId, "—") : "HRD";

  switch (input.action) {
    case "self_assessment": {
      if (!isOwner) {
        throw ApiError.forbidden("Hanya karyawan yang bersangkutan yang boleh mengisi self assessment");
      }
      await queryOne(
        `UPDATE performance.performance_reviews
         SET self_assessment = $2, updated_at = now() WHERE id = $1 RETURNING id`,
        [id, trimOrNull(input.text)]
      );
      return "Self assessment tersimpan";
    }

    case "rate_item": {
      if (!canRate) {
        throw ApiError.forbidden(
          "Hanya Head Division departemen ini (atau HRD) yang boleh menilai perilaku"
        );
      }
      const itemId = String(input.item_id || "");
      if (!UUID_RE.test(itemId)) throw ApiError.badRequest("ID item tidak valid");
      const score = parseBehaviorScore(input.score);
      const updated = await queryOne(
        `UPDATE performance.behavioral_review_items
         SET score = $3::int, weighted_score = (weight * $3::numeric / 5.0), notes = $4, updated_at = now()
         WHERE id = $2 AND review_id = $1 RETURNING id`,
        [id, itemId, score, input.notes?.trim() || null]
      );
      if (!updated) throw ApiError.badRequest("Item bukan milik review ini");
      await queryOne(
        `UPDATE performance.performance_reviews
         SET reviewer_id = COALESCE(reviewer_id, $2), reviewer_name = $3, updated_at = now()
         WHERE id = $1 RETURNING id`,
        [id, actor.employeeId, myName]
      );
      await recalcReview(id);
      return "Penilaian tersimpan";
    }

    case "reviewer_notes": {
      if (!canRate) {
        throw ApiError.forbidden("Hanya Head Division (atau HRD) yang boleh mengisi catatan reviewer");
      }
      const projectScore = parseProjectScore(input.project_score);
      await queryOne(
        `UPDATE performance.performance_reviews
         SET reviewer_notes = $2, total_project_score = COALESCE($3, 0),
             reviewer_id = COALESCE(reviewer_id, $4), reviewer_name = $5, updated_at = now()
         WHERE id = $1 RETURNING id`,
        [id, trimOrNull(input.text), projectScore, actor.employeeId, myName]
      );
      await recalcReview(id);
      return "Catatan reviewer tersimpan";
    }

    case "sign": {
      if (isOwner) {
        await queryOne(
          `UPDATE performance.performance_reviews
           SET employee_sign_date = CURRENT_DATE, updated_at = now()
           WHERE id = $1 RETURNING id`,
          [id]
        );
        return "Ditandatangani sebagai karyawan";
      }
      if (!canRate) throw ApiError.forbidden("Tidak berhak menandatangani review ini");
      await queryOne(
        `UPDATE performance.performance_reviews
         SET reviewer_sign_date = CURRENT_DATE,
             reviewer_id = COALESCE(reviewer_id, $2), reviewer_name = COALESCE(reviewer_name, $3),
             updated_at = now()
         WHERE id = $1 RETURNING id`,
        [id, actor.employeeId, myName]
      );
      return "Ditandatangani sebagai reviewer";
    }

    case "finalize": {
      if (!actor.isHr) throw ApiError.forbidden("Hanya HRD yang boleh memfinalkan review");
      await recalcReview(id);
      await queryOne(
        `UPDATE performance.performance_reviews
         SET status = 'final', manager_id = $2, manager_notes = COALESCE(manager_notes, $3),
             updated_at = now()
         WHERE id = $1 RETURNING id`,
        [id, actor.employeeId, input.text?.trim() || null]
      );
      return "Review difinalkan — nilai terkunci";
    }

    default:
      throw ApiError.badRequest("Aksi tidak dikenal");
  }
}
