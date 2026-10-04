import { z } from "zod";
import { ApiError } from "@/lib/api/auth";
import { query, queryOne, withTransaction } from "@/lib/db";
import { createUpdateSet, isUuid, slugify } from "./sql";

/** EPIC-050 T-3.1 — pipeline + tahapnya (kanban, form deal, pengaturan). */

const STAGE_COLUMNS = `
  id, code, name, sort_order, is_won, is_lost, stuck_threshold_days,
  is_active, created_at, updated_at, pipeline_id, probability`;

export const createPipelineSchema = z.object({
  name: z.string().trim().min(1).max(100),
  code: z.string().trim().regex(/^[a-z0-9-]{2,40}$/).optional(),
  description: z.string().trim().max(500).optional().nullable(),
  /** tahap awal (tanpa menang/kalah; keduanya dibuat otomatis) */
  stages: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(100),
        probability: z.number().int().min(0).max(100).default(10),
      })
    )
    .min(1)
    .max(12),
});

export const updatePipelineSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  description: z.string().trim().max(500).optional().nullable(),
  is_default: z.boolean().optional(),
  is_active: z.boolean().optional(),
  sort_order: z.number().int().min(0).max(1000).optional(),
});

export const createStageSchema = z.object({
  pipeline_id: z.string().uuid(),
  name: z.string().trim().min(1).max(100),
  sort_order: z.number().int().min(0).max(1000).optional(),
  probability: z.number().int().min(0).max(100).default(10),
  stuck_threshold_days: z.number().int().min(0).max(365).default(7),
});

export const updateStageSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  sort_order: z.number().int().min(0).max(1000).optional(),
  stuck_threshold_days: z.number().int().min(0).max(365).optional(),
  is_active: z.boolean().optional(),
  // EPIC-050 Fase 3
  probability: z.number().int().min(0).max(100).optional(),
});

export async function listPipelines(companyId: string | null, includeInactive: boolean) {
  const activeOnly = includeInactive ? "" : "AND p.is_active";
  const pipelines = await query<{ id: string }>(
    `SELECT p.id, p.code, p.name, p.description, p.is_default, p.sort_order, p.is_active, p.company_id,
            (SELECT count(*) FROM crm.crm_sales_deals d WHERE d.pipeline_id = p.id AND d.deleted_at IS NULL AND d.closed_at IS NULL)::int AS open_deals
     FROM crm.crm_pipelines p
     WHERE (p.company_id IS NULL OR p.company_id = $1) ${activeOnly}
     ORDER BY p.is_default DESC, p.sort_order, p.name`,
    [companyId]
  );
  const stages = await query<{ pipeline_id: string }>(
    `SELECT id, pipeline_id, code, name, sort_order, is_won, is_lost, stuck_threshold_days, probability, is_active
     FROM crm.crm_sales_stages WHERE pipeline_id IS NOT NULL ${includeInactive ? "" : "AND is_active"}
     ORDER BY sort_order, created_at`
  );
  const byPipeline = new Map<string, unknown[]>();
  for (const stage of stages) {
    const list = byPipeline.get(stage.pipeline_id) ?? [];
    list.push(stage);
    byPipeline.set(stage.pipeline_id, list);
  }
  return pipelines.map((p) => ({ ...p, stages: byPipeline.get(p.id) ?? [] }));
}

export async function createPipeline(
  input: z.infer<typeof createPipelineSchema>,
  companyId: string | null
) {
  const code = input.code ?? slugify(input.name, 40);
  const dup = await queryOne<{ id: string }>(`SELECT id FROM crm.crm_pipelines WHERE code = $1`, [code]);
  if (dup) throw ApiError.conflict("Kode pipeline sudah dipakai");
  return withTransaction(async (client) => {
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO crm.crm_pipelines (company_id, code, name, description, sort_order)
       VALUES ($1, $2, $3, $4, (SELECT COALESCE(max(sort_order), 0) + 10 FROM crm.crm_pipelines)) RETURNING id`,
      [companyId, code, input.name, input.description ?? null]
    );
    const pipelineId = inserted.rows[0].id;
    let order = 10;
    for (const stage of input.stages) {
      await client.query(
        `INSERT INTO crm.crm_sales_stages (code, name, sort_order, probability, pipeline_id, stuck_threshold_days)
         VALUES ($1, $2, $3, $4, $5, 7)`,
        [`${code}-${slugify(stage.name, 30)}-${order}`, stage.name, order, stage.probability, pipelineId]
      );
      order += 10;
    }
    await client.query(
      `INSERT INTO crm.crm_sales_stages (code, name, sort_order, is_won, probability, pipeline_id, stuck_threshold_days) VALUES ($1, 'Menang', $2, true, 100, $3, 0)`,
      [`${code}-menang`, order, pipelineId]
    );
    await client.query(
      `INSERT INTO crm.crm_sales_stages (code, name, sort_order, is_lost, probability, pipeline_id, stuck_threshold_days) VALUES ($1, 'Kalah', $2, true, 0, $3, 0)`,
      [`${code}-kalah`, order + 10, pipelineId]
    );
    return { id: pipelineId, code, name: input.name };
  });
}

export async function updatePipeline(id: string, input: z.infer<typeof updatePipelineSchema>) {
  const existing = await queryOne<{ id: string }>(`SELECT id FROM crm.crm_pipelines WHERE id = $1`, [id]);
  if (!existing) throw ApiError.notFound("Pipeline tidak ditemukan");
  if (input.is_default) {
    await query(`UPDATE crm.crm_pipelines SET is_default = false WHERE id <> $1`, [id]);
  }
  if (input.is_active === false) {
    const open = await queryOne<{ n: string }>(
      `SELECT count(*) AS n FROM crm.crm_sales_deals WHERE pipeline_id = $1 AND deleted_at IS NULL AND closed_at IS NULL`,
      [id]
    );
    if (Number(open?.n ?? 0) > 0) {
      throw ApiError.conflict("Pipeline masih punya deal terbuka — pindahkan dulu");
    }
  }
  const update = createUpdateSet();
  update.setAll(input);
  const { sql, values, idParam } = update.build(id);
  return queryOne(
    `UPDATE crm.crm_pipelines SET ${sql} WHERE id = ${idParam} RETURNING id, code, name, is_default, is_active`,
    values
  );
}

export async function listStages(pipelineIdRaw: string | null, includeInactive: boolean) {
  const pipelineId = isUuid(pipelineIdRaw) ? pipelineIdRaw : null;
  return query(
    `SELECT ${STAGE_COLUMNS} FROM crm.crm_sales_stages
     WHERE ($1::uuid IS NULL OR pipeline_id = $1) ${includeInactive ? "" : "AND is_active = true"}
     ORDER BY sort_order ASC, created_at ASC`,
    [pipelineId]
  );
}

export async function createStage(input: z.infer<typeof createStageSchema>) {
  const pipeline = await queryOne<{ code: string }>(`SELECT code FROM crm.crm_pipelines WHERE id = $1`, [input.pipeline_id]);
  if (!pipeline) throw ApiError.notFound("Pipeline tidak ditemukan");
  const code = `${pipeline.code}-${slugify(input.name, 30)}-${Date.now().toString(36)}`;
  const sortOrder =
    input.sort_order ??
    Number(
      (
        await queryOne<{ n: string }>(
          `SELECT COALESCE(max(sort_order), 0) AS n FROM crm.crm_sales_stages WHERE pipeline_id = $1 AND NOT is_won AND NOT is_lost`,
          [input.pipeline_id]
        )
      )?.n ?? 0
    ) + 10;
  // tahap baru selalu sebelum Menang/Kalah
  await queryOne(
    `UPDATE crm.crm_sales_stages SET sort_order = sort_order + 20 WHERE pipeline_id = $1 AND (is_won OR is_lost) AND sort_order <= $2`,
    [input.pipeline_id, sortOrder]
  );
  return queryOne(
    `INSERT INTO crm.crm_sales_stages (code, name, sort_order, probability, stuck_threshold_days, pipeline_id)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${STAGE_COLUMNS}`,
    [code, input.name, sortOrder, input.probability, input.stuck_threshold_days, input.pipeline_id]
  );
}

export async function updateStage(id: string, input: z.infer<typeof updateStageSchema>) {
  const stage = await queryOne<{ id: string; is_won: boolean; is_lost: boolean }>(
    `SELECT id, is_won, is_lost FROM crm.crm_sales_stages WHERE id = $1`,
    [id]
  );
  if (!stage) throw ApiError.notFound("Tahap tidak ditemukan");
  if (input.is_active === false) {
    if (stage.is_won || stage.is_lost) {
      throw ApiError.badRequest("Tahap Menang/Kalah tidak boleh dinonaktifkan");
    }
    const openDeal = await queryOne<{ id: string }>(
      `SELECT id FROM crm.crm_sales_deals
       WHERE stage_id = $1 AND deleted_at IS NULL AND closed_at IS NULL
       LIMIT 1`,
      [id]
    );
    if (openDeal) {
      throw ApiError.badRequest(
        "Masih ada deal berjalan di tahap ini — pindahkan dulu sebelum menonaktifkan"
      );
    }
  }
  const update = createUpdateSet();
  update.setAll(input);
  const { sql, values, idParam } = update.build(id);
  return queryOne(
    `UPDATE crm.crm_sales_stages SET ${sql}
     WHERE id = ${idParam}
     RETURNING id, code, name, sort_order, is_won, is_lost,
               stuck_threshold_days, is_active`,
    values
  );
}
