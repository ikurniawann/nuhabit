import { ApiError } from "@/lib/api/auth";
import type { PoolClient } from "pg";
import { query, queryOne, withTransaction } from "@/lib/db";
import { formatAccountCodeDisplay } from "@/lib/accounting/account-code";
import type {
  JournalMappingItem,
  JournalMappingLineItem,
  JournalMappingLinePayload,
} from "./types";

type MappingRow = {
  id: string;
  company_id: string | null;
  event_code: string;
  name: string;
  description: string | null;
  module: string;
  is_active: boolean;
  created_at: string;
  updated_at: string | null;
};

type LineRow = {
  id: string;
  mapping_id: string;
  entry_side: string;
  line_role: string;
  account_id: string | null;
  amount_source: string;
  sort_order: number;
  is_required: boolean;
  account_code: string | null;
  account_name: string | null;
};

function mapLine(row: LineRow): JournalMappingLineItem {
  return {
    id: row.id,
    mapping_id: row.mapping_id,
    entry_side: row.entry_side as JournalMappingLineItem["entry_side"],
    line_role: row.line_role,
    account_id: row.account_id,
    account_code: row.account_code
      ? formatAccountCodeDisplay(row.account_code)
      : null,
    account_name: row.account_name,
    amount_source: row.amount_source as JournalMappingLineItem["amount_source"],
    sort_order: row.sort_order,
    is_required: row.is_required,
  };
}

function mapMapping(
  row: MappingRow,
  lines: JournalMappingLineItem[]
): JournalMappingItem {
  const mapped_count = lines.filter((l) => l.account_id).length;
  return {
    id: row.id,
    company_id: row.company_id,
    event_code: row.event_code,
    name: row.name,
    description: row.description,
    module: row.module as JournalMappingItem["module"],
    is_active: row.is_active,
    created_at: row.created_at,
    updated_at: row.updated_at,
    lines,
    lines_count: lines.length,
    mapped_count,
  };
}

const LINE_SELECT = `
  l.id, l.mapping_id, l.entry_side, l.line_role, l.account_id,
  l.amount_source, l.sort_order, l.is_required,
  coa.code AS account_code, coa.name AS account_name
`;

export async function fetchLinesForMappings(
  mappingIds: string[]
): Promise<Map<string, JournalMappingLineItem[]>> {
  const map = new Map<string, JournalMappingLineItem[]>();
  if (mappingIds.length === 0) return map;

  const rows = await query<LineRow>(
    `SELECT ${LINE_SELECT}
     FROM accounting.journal_mapping_lines l
     LEFT JOIN accounting.chart_of_accounts coa
       ON coa.id = l.account_id AND coa.deleted_at IS NULL
     WHERE l.mapping_id = ANY($1::uuid[])
     ORDER BY l.sort_order ASC, l.entry_side ASC`,
    [mappingIds]
  );

  for (const row of rows) {
    const list = map.get(row.mapping_id) ?? [];
    list.push(mapLine(row));
    map.set(row.mapping_id, list);
  }
  return map;
}

export async function listJournalMappings(opts: {
  search?: string;
  module?: string;
  isActive?: string;
  companyScopeOr: string | null;
}): Promise<JournalMappingItem[]> {
  const clauses = ["m.deleted_at IS NULL"];
  const params: unknown[] = [];

  if (opts.module) {
    params.push(opts.module);
    clauses.push(`m.module = $${params.length}`);
  }
  if (opts.isActive === "true") clauses.push("m.is_active = true");
  if (opts.isActive === "false") clauses.push("m.is_active = false");
  if (opts.search) {
    params.push(`%${opts.search}%`);
    clauses.push(
      `(m.event_code ILIKE $${params.length} OR m.name ILIKE $${params.length})`
    );
  }
  if (opts.companyScopeOr) {
    // companyScopeOr like "company_id.eq.UUID" — hanya COA/mapping company
    const match = opts.companyScopeOr.match(/company_id\.eq\.(.+)$/);
    if (match?.[1]) {
      params.push(match[1]);
      clauses.push(`m.company_id = $${params.length}`);
    }
  }

  const rows = await query<MappingRow>(
    `SELECT m.id, m.company_id, m.event_code, m.name, m.description,
            m.module, m.is_active, m.created_at, m.updated_at
     FROM accounting.journal_mappings m
     WHERE ${clauses.join(" AND ")}
     ORDER BY m.module ASC, m.event_code ASC`,
    params
  );

  const lineMap = await fetchLinesForMappings(rows.map((r) => r.id));
  return rows.map((r) => mapMapping(r, lineMap.get(r.id) ?? []));
}

export async function getJournalMapping(
  id: string
): Promise<JournalMappingItem | null> {
  const row = await queryOne<MappingRow>(
    `SELECT m.id, m.company_id, m.event_code, m.name, m.description,
            m.module, m.is_active, m.created_at, m.updated_at
     FROM accounting.journal_mappings m
     WHERE m.id = $1 AND m.deleted_at IS NULL`,
    [id]
  );
  if (!row) return null;
  const lineMap = await fetchLinesForMappings([id]);
  return mapMapping(row, lineMap.get(id) ?? []);
}

async function assertPostableAccounts(
  client: PoolClient,
  accountIds: string[],
  companyId: string | null
) {
  const unique = [...new Set(accountIds.filter(Boolean))];
  if (unique.length === 0) return;

  const { rows } = await client.query<{
    id: string;
    is_postable: boolean;
    company_id: string | null;
    deleted_at: string | null;
  }>(
    `SELECT id, is_postable, company_id, deleted_at
     FROM accounting.chart_of_accounts
     WHERE id = ANY($1::uuid[])`,
    [unique]
  );

  if (rows.length !== unique.length) {
    throw ApiError.notFound("Satu atau lebih akun COA tidak ditemukan");
  }
  for (const row of rows) {
    if (row.deleted_at) throw ApiError.badRequest("Akun COA sudah dihapus");
    if (!row.is_postable) {
      throw ApiError.badRequest("Akun mapping harus postable (bukan header)");
    }
    if (
      !companyId ||
      !row.company_id ||
      row.company_id !== companyId
    ) {
      throw ApiError.badRequest("Akun COA harus dalam company yang sama");
    }
  }
}

async function replaceLines(
  client: PoolClient,
  mappingId: string,
  lines: JournalMappingLinePayload[]
) {
  await client.query(
    `DELETE FROM accounting.journal_mapping_lines WHERE mapping_id = $1`,
    [mappingId]
  );

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    await client.query(
      `INSERT INTO accounting.journal_mapping_lines (
         mapping_id, entry_side, line_role, account_id,
         amount_source, sort_order, is_required
       ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        mappingId,
        line.entry_side,
        line.line_role,
        line.account_id || null,
        line.amount_source,
        line.sort_order ?? (i + 1) * 10,
        line.is_required ?? true,
      ]
    );
  }
}

export async function createJournalMappingRecord(opts: {
  userId: string;
  companyId: string | null;
  event_code: string;
  name: string;
  description: string | null;
  module: string;
  is_active: boolean;
  lines: JournalMappingLinePayload[];
}): Promise<JournalMappingItem> {
  const id = await withTransaction(async (client) => {
    await assertPostableAccounts(
      client,
      opts.lines.map((l) => l.account_id).filter(Boolean) as string[],
      opts.companyId
    );

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO accounting.journal_mappings (
         company_id, event_code, name, description, module,
         is_active, created_by, updated_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$7)
       RETURNING id`,
      [
        opts.companyId,
        opts.event_code,
        opts.name,
        opts.description,
        opts.module,
        opts.is_active,
        opts.userId,
      ]
    );
    const mappingId = inserted.rows[0].id;
    await replaceLines(client, mappingId, opts.lines);
    return mappingId;
  });

  const detail = await getJournalMapping(id);
  if (!detail) throw new Error("Gagal memuat mapping setelah create");
  return detail;
}

export async function updateJournalMappingRecord(opts: {
  id: string;
  userId: string;
  event_code: string;
  name: string;
  description: string | null;
  module: string;
  is_active: boolean;
  lines: JournalMappingLinePayload[];
  existingCompanyId: string | null;
}): Promise<JournalMappingItem> {
  await withTransaction(async (client) => {
    await assertPostableAccounts(
      client,
      opts.lines.map((l) => l.account_id).filter(Boolean) as string[],
      opts.existingCompanyId
    );

    await client.query(
      `UPDATE accounting.journal_mappings
       SET event_code = $1,
           name = $2,
           description = $3,
           module = $4,
           is_active = $5,
           updated_by = $6,
           updated_at = now()
       WHERE id = $7 AND deleted_at IS NULL`,
      [
        opts.event_code,
        opts.name,
        opts.description,
        opts.module,
        opts.is_active,
        opts.userId,
        opts.id,
      ]
    );
    await replaceLines(client, opts.id, opts.lines);
  });

  const detail = await getJournalMapping(opts.id);
  if (!detail) throw new Error("Gagal memuat mapping setelah update");
  return detail;
}

export async function softDeleteJournalMapping(
  id: string,
  userId: string
): Promise<void> {
  await query(
    `UPDATE accounting.journal_mappings
     SET deleted_at = now(),
         deleted_by = $2,
         is_active = false,
         updated_by = $2,
         updated_at = now()
     WHERE id = $1 AND deleted_at IS NULL`,
    [id, userId]
  );
}
