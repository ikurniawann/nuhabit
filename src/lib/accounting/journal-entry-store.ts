import type { PoolClient } from "pg";
import { query, queryOne, withTransaction } from "@/lib/db";
import { formatAccountCodeDisplay } from "@/lib/accounting/account-code";
import { assertOpenFiscalPeriod } from "@/lib/accounting/fiscal";
import type {
  JournalEntryItem,
  JournalEntryLineItem,
  JournalEntryLinePayload,
} from "@/features/accounting/journal-entries/types";
import type {
  JournalEntryStatus,
  JournalLineSide,
} from "@/lib/accounting/fiscal-types";

type EntryRow = {
  id: string;
  company_id: string | null;
  entry_no: string;
  entry_date: string;
  description: string | null;
  fiscal_period_id: string;
  fiscal_period_name: string | null;
  fiscal_year_code: string | null;
  entry_type: string;
  status: string;
  is_recon: boolean;
  posted_at: string | null;
  posted_by: string | null;
  created_at: string;
  updated_at: string | null;
  source_module?: string | null;
  source_event_code?: string | null;
  source_document_type?: string | null;
  source_document_id?: string | null;
};

type LineRow = {
  id: string;
  entry_id: string;
  account_id: string;
  entry_side: string;
  amount: string;
  memo: string | null;
  sort_order: number;
  account_code: string | null;
  account_name: string | null;
};

function mapLine(row: LineRow): JournalEntryLineItem {
  return {
    id: row.id,
    entry_id: row.entry_id,
    account_id: row.account_id,
    account_code: row.account_code
      ? formatAccountCodeDisplay(row.account_code)
      : null,
    account_name: row.account_name,
    entry_side: row.entry_side as JournalLineSide,
    amount: Number(row.amount),
    memo: row.memo,
    sort_order: row.sort_order,
  };
}

function mapEntry(
  row: EntryRow,
  lines: JournalEntryLineItem[]
): JournalEntryItem {
  const total_debit = lines
    .filter((l) => l.entry_side === "DEBIT")
    .reduce((s, l) => s + l.amount, 0);
  const total_credit = lines
    .filter((l) => l.entry_side === "CREDIT")
    .reduce((s, l) => s + l.amount, 0);
  const status = row.status as JournalEntryStatus;
  const entry_type =
    row.entry_type === "OPENING"
      ? ("OPENING" as const)
      : row.entry_type === "AUTO"
        ? ("AUTO" as const)
        : ("MANUAL" as const);
  return {
    id: row.id,
    company_id: row.company_id,
    entry_no: row.entry_no,
    entry_date: row.entry_date,
    description: row.description,
    fiscal_period_id: row.fiscal_period_id,
    fiscal_period_name: row.fiscal_period_name,
    fiscal_year_code: row.fiscal_year_code,
    entry_type,
    status,
    is_recon: row.is_recon,
    posted_at: row.posted_at,
    posted_by: row.posted_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
    source_module: row.source_module ?? null,
    source_event_code: row.source_event_code ?? null,
    source_document_type: row.source_document_type ?? null,
    source_document_id: row.source_document_id ?? null,
    lines,
    total_debit: round2(total_debit),
    total_credit: round2(total_credit),
    // OPENING/AUTO dikelola sistem — bukan form JE biasa
    can_edit: status === "DRAFT" && !row.is_recon && entry_type === "MANUAL",
  };
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

const ENTRY_SELECT = `
  e.id, e.company_id, e.entry_no,
  e.entry_date::text AS entry_date,
  e.description, e.fiscal_period_id,
  p.name AS fiscal_period_name,
  y.code AS fiscal_year_code,
  COALESCE(e.entry_type, 'MANUAL') AS entry_type,
  e.status, e.is_recon, e.posted_at, e.posted_by,
  e.created_at, e.updated_at,
  e.source_module, e.source_event_code,
  e.source_document_type, e.source_document_id
`;

const LINE_SELECT = `
  l.id, l.entry_id, l.account_id, l.entry_side,
  l.amount::text AS amount, l.memo, l.sort_order,
  coa.code AS account_code, coa.name AS account_name
`;

export async function fetchLinesForEntries(
  entryIds: string[]
): Promise<Map<string, JournalEntryLineItem[]>> {
  const map = new Map<string, JournalEntryLineItem[]>();
  if (entryIds.length === 0) return map;

  const rows = await query<LineRow>(
    `SELECT ${LINE_SELECT}
     FROM accounting.journal_entry_lines l
     LEFT JOIN accounting.chart_of_accounts coa
       ON coa.id = l.account_id AND coa.deleted_at IS NULL
     WHERE l.entry_id = ANY($1::uuid[])
     ORDER BY l.sort_order ASC, l.entry_side ASC`,
    [entryIds]
  );

  for (const row of rows) {
    const list = map.get(row.entry_id) ?? [];
    list.push(mapLine(row));
    map.set(row.entry_id, list);
  }
  return map;
}

export async function listJournalEntries(opts: {
  search?: string;
  status?: string;
  dateFrom?: string;
  dateTo?: string;
  entryType?: string;
  accountId?: string;
  companyScopeOr: string | null;
}): Promise<JournalEntryItem[]> {
  const clauses = ["e.deleted_at IS NULL"];
  const params: unknown[] = [];

  if (opts.status) {
    params.push(opts.status);
    clauses.push(`e.status = $${params.length}`);
  }
  if (opts.entryType) {
    params.push(opts.entryType);
    clauses.push(`e.entry_type = $${params.length}`);
  }
  if (opts.dateFrom) {
    params.push(opts.dateFrom);
    clauses.push(`e.entry_date >= $${params.length}::date`);
  }
  if (opts.dateTo) {
    params.push(opts.dateTo);
    clauses.push(`e.entry_date <= $${params.length}::date`);
  }
  if (opts.search) {
    params.push(`%${opts.search}%`);
    clauses.push(
      `(e.entry_no ILIKE $${params.length} OR e.description ILIKE $${params.length})`
    );
  }
  if (opts.accountId) {
    params.push(opts.accountId);
    clauses.push(
      `EXISTS (
         SELECT 1 FROM accounting.journal_entry_lines l
         WHERE l.entry_id = e.id AND l.account_id = $${params.length}::uuid
       )`
    );
  }
  if (opts.companyScopeOr) {
    const match = opts.companyScopeOr.match(/company_id\.eq\.(.+)$/);
    if (match?.[1]) {
      params.push(match[1]);
      clauses.push(`e.company_id = $${params.length}`);
    }
  }

  const rows = await query<EntryRow>(
    `SELECT ${ENTRY_SELECT}
     FROM accounting.journal_entries e
     JOIN accounting.fiscal_periods p ON p.id = e.fiscal_period_id
     JOIN accounting.fiscal_years y ON y.id = p.fiscal_year_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY e.entry_date DESC, e.entry_no DESC`,
    params
  );

  const lineMap = await fetchLinesForEntries(rows.map((r) => r.id));
  return rows.map((r) => mapEntry(r, lineMap.get(r.id) ?? []));
}

export async function getJournalEntry(
  id: string
): Promise<JournalEntryItem | null> {
  const row = await queryOne<EntryRow>(
    `SELECT ${ENTRY_SELECT}
     FROM accounting.journal_entries e
     JOIN accounting.fiscal_periods p ON p.id = e.fiscal_period_id
     JOIN accounting.fiscal_years y ON y.id = p.fiscal_year_id
     WHERE e.id = $1 AND e.deleted_at IS NULL`,
    [id]
  );
  if (!row) return null;
  const lineMap = await fetchLinesForEntries([id]);
  return mapEntry(row, lineMap.get(id) ?? []);
}

function assertMutable(entry: JournalEntryItem) {
  if (entry.entry_type === "OPENING") {
    throw new Error(
      "Beginning balance (OPENING) dikelola lewat menu Beginning Balance"
    );
  }
  if (entry.entry_type === "AUTO") {
    throw new Error(
      "Journal entry AUTO dari modul operasional tidak bisa diubah dari sini"
    );
  }
  if (entry.status === "POSTED") {
    throw new Error("Journal entry POSTED tidak bisa diubah/dihapus");
  }
  if (entry.is_recon) {
    throw new Error("Journal entry dengan flag recon tidak bisa diubah/dihapus");
  }
}

function validateLines(lines: JournalEntryLinePayload[]) {
  if (lines.length < 2) {
    throw new Error("Minimal 2 baris jurnal (debit dan credit)");
  }

  let debit = 0;
  let credit = 0;
  let hasDebit = false;
  let hasCredit = false;

  for (const line of lines) {
    if (!line.account_id) throw new Error("Setiap baris harus punya akun COA");
    if (line.entry_side !== "DEBIT" && line.entry_side !== "CREDIT") {
      throw new Error("entry_side harus DEBIT atau CREDIT");
    }
    const amount = Number(line.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error("Amount harus lebih dari 0");
    }
    if (line.entry_side === "DEBIT") {
      debit += amount;
      hasDebit = true;
    } else {
      credit += amount;
      hasCredit = true;
    }
  }

  if (!hasDebit || !hasCredit) {
    throw new Error("Harus ada minimal satu baris Debit dan satu baris Credit");
  }
  if (round2(debit) !== round2(credit)) {
    throw new Error(
      `Jurnal tidak balance: Debit ${round2(debit)} ≠ Credit ${round2(credit)}`
    );
  }
}

async function assertPostableAccounts(
  client: PoolClient,
  accountIds: string[],
  companyId: string | null
) {
  const unique = [...new Set(accountIds.filter(Boolean))];
  if (unique.length === 0) throw new Error("Akun COA wajib diisi");

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
    throw new Error("Satu atau lebih akun COA tidak ditemukan");
  }
  for (const row of rows) {
    if (row.deleted_at) throw new Error("Akun COA sudah dihapus");
    if (!row.is_postable) {
      throw new Error("Akun jurnal harus postable (bukan header)");
    }
    if (
      !companyId ||
      !row.company_id ||
      row.company_id !== companyId
    ) {
      throw new Error("Akun COA harus dalam company yang sama");
    }
  }
}

async function replaceLines(
  client: PoolClient,
  entryId: string,
  lines: JournalEntryLinePayload[]
) {
  await client.query(
    `DELETE FROM accounting.journal_entry_lines WHERE entry_id = $1`,
    [entryId]
  );

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    await client.query(
      `INSERT INTO accounting.journal_entry_lines (
         entry_id, account_id, entry_side, amount, memo, sort_order
       ) VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        entryId,
        line.account_id,
        line.entry_side,
        round2(Number(line.amount)),
        line.memo?.trim() || null,
        line.sort_order ?? (i + 1) * 10,
      ]
    );
  }
}

async function nextEntryNo(
  client: PoolClient,
  entryDate: string,
  companyId: string | null
): Promise<string> {
  const ym = entryDate.slice(0, 7).replace("-", "");
  const prefix = `JE-${ym}-`;

  const { rows } = await client.query<{ entry_no: string }>(
    `SELECT entry_no
     FROM accounting.journal_entries
     WHERE deleted_at IS NULL
       AND entry_no LIKE $1
       AND (
         ($2::uuid IS NULL AND company_id IS NULL)
         OR ($2::uuid IS NOT NULL AND company_id = $2::uuid)
       )
     ORDER BY entry_no DESC
     LIMIT 1
     FOR UPDATE`,
    [`${prefix}%`, companyId]
  );

  let seq = 1;
  if (rows[0]) {
    const tail = rows[0].entry_no.slice(prefix.length);
    const n = Number.parseInt(tail, 10);
    if (Number.isFinite(n)) seq = n + 1;
  }
  return `${prefix}${String(seq).padStart(4, "0")}`;
}

export type CreateJournalEntrySource = {
  entry_type?: "MANUAL" | "AUTO";
  source_module?: string | null;
  source_event_code?: string | null;
  source_document_type?: string | null;
  source_document_id?: string | null;
};

export async function createJournalEntryRecord(opts: {
  /** null = posting otomatis oleh sistem (webhook pembayaran, job harian). */
  userId: string | null;
  companyId: string | null;
  entry_date: string;
  description: string | null;
  is_recon: boolean;
  lines: JournalEntryLinePayload[];
  post: boolean;
} & CreateJournalEntrySource): Promise<JournalEntryItem> {
  validateLines(opts.lines);

  const entryType = opts.entry_type ?? "MANUAL";

  const id = await withTransaction(async (client) => {
    const period = await assertOpenFiscalPeriod(
      opts.entry_date,
      opts.companyId,
      client
    );
    await assertPostableAccounts(
      client,
      opts.lines.map((l) => l.account_id),
      opts.companyId
    );

    const entryNo = await nextEntryNo(client, opts.entry_date, opts.companyId);
    const status = opts.post ? "POSTED" : "DRAFT";

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO accounting.journal_entries (
         company_id, entry_no, entry_date, description,
         fiscal_period_id, status, is_recon, entry_type,
         source_module, source_event_code,
         source_document_type, source_document_id,
         posted_at, posted_by, created_by, updated_by
       ) VALUES (
         $1,$2,$3::date,$4,$5,$6::varchar,$7,$8::varchar,
         $9,$10,$11,$12::uuid,
         CASE WHEN $6::text = 'POSTED' THEN now() ELSE NULL END,
         CASE WHEN $6::text = 'POSTED' THEN $13::uuid ELSE NULL END,
         $13::uuid,$13::uuid
       )
       RETURNING id`,
      [
        opts.companyId,
        entryNo,
        opts.entry_date,
        opts.description,
        period.id,
        status,
        opts.is_recon,
        entryType,
        opts.source_module ?? null,
        opts.source_event_code ?? null,
        opts.source_document_type ?? null,
        opts.source_document_id ?? null,
        opts.userId,
      ]
    );

    const entryId = inserted.rows[0].id;
    await replaceLines(client, entryId, opts.lines);
    return entryId;
  });

  const detail = await getJournalEntry(id);
  if (!detail) throw new Error("Gagal memuat journal entry setelah create");
  return detail;
}

export async function findJournalEntryBySource(opts: {
  companyId: string | null;
  sourceEventCode: string;
  sourceDocumentId: string;
}): Promise<JournalEntryItem | null> {
  const row = await queryOne<EntryRow>(
    `SELECT ${ENTRY_SELECT}
     FROM accounting.journal_entries e
     JOIN accounting.fiscal_periods p ON p.id = e.fiscal_period_id
     JOIN accounting.fiscal_years y ON y.id = p.fiscal_year_id
     WHERE e.deleted_at IS NULL
       AND e.source_event_code = $1
       AND e.source_document_id = $2::uuid
       AND (
         ($3::uuid IS NULL AND e.company_id IS NULL)
         OR ($3::uuid IS NOT NULL AND e.company_id = $3::uuid)
       )
     LIMIT 1`,
    [opts.sourceEventCode, opts.sourceDocumentId, opts.companyId]
  );
  if (!row) return null;
  const lineMap = await fetchLinesForEntries([row.id]);
  return mapEntry(row, lineMap.get(row.id) ?? []);
}

export async function updateJournalEntryRecord(opts: {
  id: string;
  userId: string;
  companyId: string | null;
  entry_date: string;
  description: string | null;
  lines: JournalEntryLinePayload[];
  post: boolean;
}): Promise<JournalEntryItem> {
  const existing = await getJournalEntry(opts.id);
  if (!existing) throw new Error("Journal entry tidak ditemukan");
  assertMutable(existing);
  validateLines(opts.lines);

  await withTransaction(async (client) => {
    const period = await assertOpenFiscalPeriod(
      opts.entry_date,
      opts.companyId,
      client
    );
    await assertPostableAccounts(
      client,
      opts.lines.map((l) => l.account_id),
      opts.companyId
    );

    const status = opts.post ? "POSTED" : "DRAFT";

    await client.query(
      `UPDATE accounting.journal_entries
       SET entry_date = $1::date,
           description = $2,
           fiscal_period_id = $3,
           status = $4::varchar,
           posted_at = CASE WHEN $4::text = 'POSTED' THEN COALESCE(posted_at, now()) ELSE NULL END,
           posted_by = CASE WHEN $4::text = 'POSTED' THEN COALESCE(posted_by, $5::uuid) ELSE NULL END,
           updated_by = $5::uuid,
           updated_at = now()
       WHERE id = $6::uuid AND deleted_at IS NULL`,
      [
        opts.entry_date,
        opts.description,
        period.id,
        status,
        opts.userId,
        opts.id,
      ]
    );
    await replaceLines(client, opts.id, opts.lines);
  });

  const detail = await getJournalEntry(opts.id);
  if (!detail) throw new Error("Gagal memuat journal entry setelah update");
  return detail;
}

export async function postJournalEntry(
  id: string,
  userId: string
): Promise<JournalEntryItem> {
  const existing = await getJournalEntry(id);
  if (!existing) throw new Error("Journal entry tidak ditemukan");
  if (existing.status === "POSTED") {
    throw new Error("Journal entry sudah POSTED");
  }
  if (existing.lines.length < 2) {
    throw new Error("Minimal 2 baris jurnal sebelum post");
  }
  if (round2(existing.total_debit) !== round2(existing.total_credit)) {
    throw new Error("Jurnal tidak balance");
  }

  await withTransaction(async (client) => {
    await assertOpenFiscalPeriod(
      existing.entry_date,
      existing.company_id,
      client
    );

    await client.query(
      `UPDATE accounting.journal_entries
       SET status = 'POSTED',
           posted_at = now(),
           posted_by = $2,
           updated_by = $2,
           updated_at = now()
       WHERE id = $1 AND deleted_at IS NULL AND status = 'DRAFT'`,
      [id, userId]
    );
  });

  const detail = await getJournalEntry(id);
  if (!detail) throw new Error("Gagal memuat journal entry setelah post");
  return detail;
}

export async function softDeleteJournalEntry(
  id: string,
  userId: string
): Promise<void> {
  const existing = await getJournalEntry(id);
  if (!existing) throw new Error("Journal entry tidak ditemukan");
  assertMutable(existing);

  await query(
    `UPDATE accounting.journal_entries
     SET deleted_at = now(),
         deleted_by = $2,
         updated_by = $2,
         updated_at = now()
     WHERE id = $1 AND deleted_at IS NULL`,
    [id, userId]
  );
}
