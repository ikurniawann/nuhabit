import { ApiError } from "@/lib/api/auth";
import { query, queryOne } from "@/lib/db";
import { formatAccountCodeDisplay } from "@/lib/accounting/account-code";
import { createJournalEntryRecord } from "@/lib/accounting/journal-entry-store";

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

export type CashBankAccount = {
  id: string;
  code: string;
  code_display: string;
  name: string;
  account_type_code: string | null;
  normal_balance: "DEBIT" | "CREDIT";
  balance: number;
  movement_count: number;
};

export type CashBankLedgerLine = {
  line_id: string;
  entry_id: string;
  entry_no: string;
  entry_date: string;
  entry_type: string;
  description: string | null;
  memo: string | null;
  entry_side: "DEBIT" | "CREDIT";
  debit: number;
  credit: number;
  running_balance: number;
};

export type CashBankLedger = {
  account: {
    id: string;
    code: string;
    code_display: string;
    name: string;
    normal_balance: "DEBIT" | "CREDIT";
  };
  date_from: string | null;
  date_to: string | null;
  opening_balance: number;
  closing_balance: number;
  total_debit: number;
  total_credit: number;
  lines: CashBankLedgerLine[];
};

function signedDelta(
  side: string,
  amount: number,
  normalBalance: "DEBIT" | "CREDIT"
) {
  const isIncrease =
    (normalBalance === "DEBIT" && side === "DEBIT") ||
    (normalBalance === "CREDIT" && side === "CREDIT");
  return isIncrease ? amount : -amount;
}

export async function listCashBankAccounts(
  companyId: string
): Promise<CashBankAccount[]> {
  const rows = await query<{
    id: string;
    code: string;
    name: string;
    account_type_code: string | null;
    normal_balance: string;
    debit: string;
    credit: string;
    movement_count: string;
  }>(
    `SELECT
       coa.id,
       coa.code,
       coa.name,
       t.code AS account_type_code,
       t.normal_balance,
       COALESCE(SUM(mov.debit), 0)::text AS debit,
       COALESCE(SUM(mov.credit), 0)::text AS credit,
       COALESCE(COUNT(mov.line_id), 0)::text AS movement_count
     FROM accounting.chart_of_accounts coa
     JOIN accounting.account_types t ON t.id = coa.account_type_id
     LEFT JOIN (
       SELECT
         l.account_id,
         l.id AS line_id,
         CASE WHEN l.entry_side = 'DEBIT' THEN l.amount ELSE 0 END AS debit,
         CASE WHEN l.entry_side = 'CREDIT' THEN l.amount ELSE 0 END AS credit
       FROM accounting.journal_entry_lines l
       JOIN accounting.journal_entries e
         ON e.id = l.entry_id
        AND e.deleted_at IS NULL
        AND e.status = 'POSTED'
        AND e.company_id = $1::uuid
     ) mov ON mov.account_id = coa.id
     WHERE coa.deleted_at IS NULL
       AND coa.is_active = true
       AND coa.is_cash_bank = true
       AND coa.company_id = $1::uuid
     GROUP BY coa.id, coa.code, coa.name, t.code, t.normal_balance
     ORDER BY coa.code ASC`,
    [companyId]
  );

  return rows.map((row) => {
    const normal =
      row.normal_balance === "CREDIT" ? ("CREDIT" as const) : ("DEBIT" as const);
    const debit = Number(row.debit);
    const credit = Number(row.credit);
    const balance =
      normal === "DEBIT" ? round2(debit - credit) : round2(credit - debit);
    return {
      id: row.id,
      code: row.code,
      code_display: formatAccountCodeDisplay(row.code),
      name: row.name,
      account_type_code: row.account_type_code,
      normal_balance: normal,
      balance,
      movement_count: Number(row.movement_count),
    };
  });
}

export async function getCashBankLedger(opts: {
  companyId: string;
  accountId: string;
  dateFrom?: string;
  dateTo?: string;
}): Promise<CashBankLedger | null> {
  const account = await queryOne<{
    id: string;
    code: string;
    name: string;
    normal_balance: string;
    company_id: string | null;
    is_cash_bank: boolean;
    deleted_at: string | null;
  }>(
    `SELECT coa.id, coa.code, coa.name, t.normal_balance,
            coa.company_id, coa.is_cash_bank, coa.deleted_at
     FROM accounting.chart_of_accounts coa
     JOIN accounting.account_types t ON t.id = coa.account_type_id
     WHERE coa.id = $1::uuid`,
    [opts.accountId]
  );

  if (
    !account ||
    account.deleted_at ||
    !account.is_cash_bank ||
    account.company_id !== opts.companyId
  ) {
    return null;
  }

  const normal =
    account.normal_balance === "CREDIT"
      ? ("CREDIT" as const)
      : ("DEBIT" as const);

  // Opening = posted movements before date_from
  let openingBalance = 0;
  if (opts.dateFrom) {
    const opening = await queryOne<{ debit: string; credit: string }>(
      `SELECT
         COALESCE(SUM(CASE WHEN l.entry_side = 'DEBIT' THEN l.amount ELSE 0 END), 0)::text AS debit,
         COALESCE(SUM(CASE WHEN l.entry_side = 'CREDIT' THEN l.amount ELSE 0 END), 0)::text AS credit
       FROM accounting.journal_entry_lines l
       JOIN accounting.journal_entries e
         ON e.id = l.entry_id AND e.deleted_at IS NULL AND e.status = 'POSTED'
       WHERE l.account_id = $1::uuid
         AND e.company_id = $2::uuid
         AND e.entry_date < $3::date`,
      [opts.accountId, opts.companyId, opts.dateFrom]
    );
    const d = Number(opening?.debit ?? 0);
    const c = Number(opening?.credit ?? 0);
    openingBalance =
      normal === "DEBIT" ? round2(d - c) : round2(c - d);
  }

  const params: unknown[] = [opts.accountId, opts.companyId];
  const clauses = [
    "l.account_id = $1::uuid",
    "e.company_id = $2::uuid",
    "e.deleted_at IS NULL",
    "e.status = 'POSTED'",
  ];
  if (opts.dateFrom) {
    params.push(opts.dateFrom);
    clauses.push(`e.entry_date >= $${params.length}::date`);
  }
  if (opts.dateTo) {
    params.push(opts.dateTo);
    clauses.push(`e.entry_date <= $${params.length}::date`);
  }

  const movementRows = await query<{
    line_id: string;
    entry_id: string;
    entry_no: string;
    entry_date: string;
    entry_type: string;
    description: string | null;
    memo: string | null;
    entry_side: string;
    amount: string;
  }>(
    `SELECT
       l.id AS line_id,
       e.id AS entry_id,
       e.entry_no,
       e.entry_date::text AS entry_date,
       COALESCE(e.entry_type, 'MANUAL') AS entry_type,
       e.description,
       l.memo,
       l.entry_side,
       l.amount::text AS amount
     FROM accounting.journal_entry_lines l
     JOIN accounting.journal_entries e ON e.id = l.entry_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY e.entry_date ASC, e.entry_no ASC, l.sort_order ASC, l.entry_side ASC`,
    params
  );

  let running = openingBalance;
  let totalDebit = 0;
  let totalCredit = 0;
  const lines: CashBankLedgerLine[] = movementRows.map((row) => {
    const amount = Number(row.amount);
    const debit = row.entry_side === "DEBIT" ? amount : 0;
    const credit = row.entry_side === "CREDIT" ? amount : 0;
    totalDebit = round2(totalDebit + debit);
    totalCredit = round2(totalCredit + credit);
    running = round2(
      running + signedDelta(row.entry_side, amount, normal)
    );
    return {
      line_id: row.line_id,
      entry_id: row.entry_id,
      entry_no: row.entry_no,
      entry_date: row.entry_date,
      entry_type: row.entry_type,
      description: row.description,
      memo: row.memo,
      entry_side: row.entry_side === "CREDIT" ? "CREDIT" : "DEBIT",
      debit,
      credit,
      running_balance: running,
    };
  });

  return {
    account: {
      id: account.id,
      code: account.code,
      code_display: formatAccountCodeDisplay(account.code),
      name: account.name,
      normal_balance: normal,
    },
    date_from: opts.dateFrom ?? null,
    date_to: opts.dateTo ?? null,
    opening_balance: openingBalance,
    closing_balance: running,
    total_debit: totalDebit,
    total_credit: totalCredit,
    lines,
  };
}

export type CashMovementKind = "cash_in" | "cash_out";

export type CashMovementRow = {
  id: string;
  entry_no: string;
  entry_date: string;
  description: string | null;
  kind: CashMovementKind;
  amount: number;
  cash_account_id: string;
  cash_account_code: string;
  cash_account_name: string;
  offset_account_id: string;
  offset_account_code: string;
  offset_account_name: string;
  status: string;
  created_at: string;
};

export type PostableAccountOption = {
  id: string;
  code: string;
  code_display: string;
  name: string;
  is_cash_bank: boolean;
};

export async function listPostableAccounts(
  companyId: string
): Promise<PostableAccountOption[]> {
  const rows = await query<{
    id: string;
    code: string;
    name: string;
    is_cash_bank: boolean;
  }>(
    `SELECT id, code, name, is_cash_bank
       FROM accounting.chart_of_accounts
      WHERE deleted_at IS NULL
        AND is_active = true
        AND is_postable = true
        AND company_id = $1::uuid
      ORDER BY code ASC`,
    [companyId]
  );
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    code_display: formatAccountCodeDisplay(r.code),
    name: r.name,
    is_cash_bank: r.is_cash_bank,
  }));
}

async function assertCashBankAccount(
  companyId: string,
  accountId: string
): Promise<{ id: string; code: string; name: string }> {
  const row = await queryOne<{
    id: string;
    code: string;
    name: string;
    is_cash_bank: boolean;
    is_postable: boolean;
    company_id: string | null;
    deleted_at: string | null;
  }>(
    `SELECT id, code, name, is_cash_bank, is_postable, company_id, deleted_at
       FROM accounting.chart_of_accounts
      WHERE id = $1::uuid`,
    [accountId]
  );
  if (
    !row ||
    row.deleted_at ||
    !row.is_postable ||
    !row.is_cash_bank ||
    row.company_id !== companyId
  ) {
    throw ApiError.badRequest("Akun kas/bank tidak valid");
  }
  return { id: row.id, code: row.code, name: row.name };
}

async function assertOffsetAccount(
  companyId: string,
  accountId: string,
  cashAccountId: string
): Promise<{ id: string; code: string; name: string }> {
  if (accountId === cashAccountId) {
    throw ApiError.badRequest("Akun lawan tidak boleh sama dengan akun kas/bank");
  }
  const row = await queryOne<{
    id: string;
    code: string;
    name: string;
    is_postable: boolean;
    company_id: string | null;
    deleted_at: string | null;
  }>(
    `SELECT id, code, name, is_postable, company_id, deleted_at
       FROM accounting.chart_of_accounts
      WHERE id = $1::uuid`,
    [accountId]
  );
  if (
    !row ||
    row.deleted_at ||
    !row.is_postable ||
    row.company_id !== companyId
  ) {
    throw ApiError.badRequest("Akun lawan tidak valid / tidak postable");
  }
  return { id: row.id, code: row.code, name: row.name };
}

/**
 * Cash In: Debit kas/bank, Credit akun lawan.
 * Cash Out: Debit akun lawan, Credit kas/bank.
 * Creates a POSTED manual journal entry tagged with source_document_type.
 */
export async function createCashMovement(opts: {
  userId: string;
  companyId: string;
  kind: CashMovementKind;
  entryDate: string;
  amount: number;
  cashAccountId: string;
  offsetAccountId: string;
  description?: string | null;
  memo?: string | null;
}): Promise<CashMovementRow> {
  const amount = round2(opts.amount);
  if (!(amount > 0)) throw ApiError.badRequest("Amount harus lebih dari 0");

  const cash = await assertCashBankAccount(opts.companyId, opts.cashAccountId);
  const offset = await assertOffsetAccount(
    opts.companyId,
    opts.offsetAccountId,
    opts.cashAccountId
  );

  const isIn = opts.kind === "cash_in";
  const label = isIn ? "Cash In" : "Cash Out";
  const description =
    opts.description?.trim() ||
    `${label}: ${cash.code} ${cash.name} ↔ ${offset.code} ${offset.name}`;

  const cashSide = isIn ? ("DEBIT" as const) : ("CREDIT" as const);
  const offsetSide = isIn ? ("CREDIT" as const) : ("DEBIT" as const);

  const entry = await createJournalEntryRecord({
    userId: opts.userId,
    companyId: opts.companyId,
    entry_date: opts.entryDate,
    description,
    is_recon: false,
    post: true,
    entry_type: "MANUAL",
    source_module: "CASH_BANK",
    source_event_code: isIn ? "CASH_IN" : "CASH_OUT",
    source_document_type: opts.kind,
    source_document_id: null,
    lines: [
      {
        account_id: cash.id,
        entry_side: cashSide,
        amount,
        memo: opts.memo?.trim() || label,
        sort_order: 10,
      },
      {
        account_id: offset.id,
        entry_side: offsetSide,
        amount,
        memo: opts.memo?.trim() || label,
        sort_order: 20,
      },
    ],
  });

  return {
    id: entry.id,
    entry_no: entry.entry_no,
    entry_date: entry.entry_date,
    description: entry.description,
    kind: opts.kind,
    amount,
    cash_account_id: cash.id,
    cash_account_code: formatAccountCodeDisplay(cash.code),
    cash_account_name: cash.name,
    offset_account_id: offset.id,
    offset_account_code: formatAccountCodeDisplay(offset.code),
    offset_account_name: offset.name,
    status: entry.status,
    created_at: entry.created_at,
  };
}

export async function listCashMovements(opts: {
  companyId: string;
  kind: CashMovementKind;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
  offset?: number;
}): Promise<{ rows: CashMovementRow[]; total: number }> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);
  const offsetN = Math.max(opts.offset ?? 0, 0);
  const cashSide = opts.kind === "cash_in" ? "DEBIT" : "CREDIT";
  const offsetSide = opts.kind === "cash_in" ? "CREDIT" : "DEBIT";

  const params: unknown[] = [opts.companyId, opts.kind, cashSide, offsetSide];
  const where = [
    "e.deleted_at IS NULL",
    "e.company_id = $1::uuid",
    "e.source_document_type = $2",
  ];

  if (opts.dateFrom) {
    params.push(opts.dateFrom);
    where.push(`e.entry_date >= $${params.length}::date`);
  }
  if (opts.dateTo) {
    params.push(opts.dateTo);
    where.push(`e.entry_date <= $${params.length}::date`);
  }
  if (opts.search?.trim()) {
    params.push(`%${opts.search.trim()}%`);
    where.push(
      `(e.entry_no ILIKE $${params.length} OR COALESCE(e.description,'') ILIKE $${params.length})`
    );
  }

  params.push(limit);
  const limPh = `$${params.length}`;
  params.push(offsetN);
  const offPh = `$${params.length}`;

  type Row = {
    id: string;
    entry_no: string;
    entry_date: string;
    description: string | null;
    status: string;
    created_at: string;
    amount: string;
    cash_account_id: string;
    cash_account_code: string;
    cash_account_name: string;
    offset_account_id: string;
    offset_account_code: string;
    offset_account_name: string;
    _total: number;
  };

  const rows = await query<Row>(
    `SELECT
       e.id,
       e.entry_no,
       e.entry_date::text AS entry_date,
       e.description,
       e.status,
       e.created_at,
       cash_line.amount::text AS amount,
       cash_acc.id AS cash_account_id,
       cash_acc.code AS cash_account_code,
       cash_acc.name AS cash_account_name,
       offset_acc.id AS offset_account_id,
       offset_acc.code AS offset_account_code,
       offset_acc.name AS offset_account_name,
       COUNT(*) OVER()::int AS _total
     FROM accounting.journal_entries e
     JOIN accounting.journal_entry_lines cash_line
       ON cash_line.entry_id = e.id AND cash_line.entry_side = $3
     JOIN accounting.chart_of_accounts cash_acc
       ON cash_acc.id = cash_line.account_id AND cash_acc.is_cash_bank = true
     JOIN accounting.journal_entry_lines offset_line
       ON offset_line.entry_id = e.id
      AND offset_line.entry_side = $4
      AND offset_line.account_id <> cash_line.account_id
     JOIN accounting.chart_of_accounts offset_acc
       ON offset_acc.id = offset_line.account_id
     WHERE ${where.join(" AND ")}
     ORDER BY e.entry_date DESC, e.entry_no DESC
     LIMIT ${limPh} OFFSET ${offPh}`,
    params
  );

  return {
    rows: rows.map((r) => ({
      id: r.id,
      entry_no: r.entry_no,
      entry_date: String(r.entry_date).slice(0, 10),
      description: r.description,
      kind: opts.kind,
      amount: Number(r.amount) || 0,
      cash_account_id: r.cash_account_id,
      cash_account_code: formatAccountCodeDisplay(r.cash_account_code),
      cash_account_name: r.cash_account_name,
      offset_account_id: r.offset_account_id,
      offset_account_code: formatAccountCodeDisplay(r.offset_account_code),
      offset_account_name: r.offset_account_name,
      status: r.status,
      created_at: r.created_at,
    })),
    total: Number(rows[0]?._total ?? 0),
  };
}

export type CashTransferRow = {
  id: string;
  entry_no: string;
  entry_date: string;
  description: string | null;
  amount: number;
  from_account_id: string;
  from_account_code: string;
  from_account_name: string;
  to_account_id: string;
  to_account_code: string;
  to_account_name: string;
  status: string;
  created_at: string;
};

/**
 * Transfer antar kas/bank: Debit akun tujuan, Credit akun asal.
 */
export async function createCashTransfer(opts: {
  userId: string;
  companyId: string;
  entryDate: string;
  amount: number;
  fromAccountId: string;
  toAccountId: string;
  description?: string | null;
  memo?: string | null;
}): Promise<CashTransferRow> {
  const amount = round2(opts.amount);
  if (!(amount > 0)) throw ApiError.badRequest("Amount harus lebih dari 0");
  if (opts.fromAccountId === opts.toAccountId) {
    throw ApiError.badRequest("Akun asal dan tujuan tidak boleh sama");
  }

  const from = await assertCashBankAccount(opts.companyId, opts.fromAccountId);
  const to = await assertCashBankAccount(opts.companyId, opts.toAccountId);

  const description =
    opts.description?.trim() ||
    `Transfer: ${from.code} ${from.name} → ${to.code} ${to.name}`;
  const memo = opts.memo?.trim() || "Cash Transfer";

  const entry = await createJournalEntryRecord({
    userId: opts.userId,
    companyId: opts.companyId,
    entry_date: opts.entryDate,
    description,
    is_recon: false,
    post: true,
    entry_type: "MANUAL",
    source_module: "CASH_BANK",
    source_event_code: "CASH_TRANSFER",
    source_document_type: "cash_transfer",
    source_document_id: null,
    lines: [
      {
        account_id: to.id,
        entry_side: "DEBIT",
        amount,
        memo,
        sort_order: 10,
      },
      {
        account_id: from.id,
        entry_side: "CREDIT",
        amount,
        memo,
        sort_order: 20,
      },
    ],
  });

  return {
    id: entry.id,
    entry_no: entry.entry_no,
    entry_date: entry.entry_date,
    description: entry.description,
    amount,
    from_account_id: from.id,
    from_account_code: formatAccountCodeDisplay(from.code),
    from_account_name: from.name,
    to_account_id: to.id,
    to_account_code: formatAccountCodeDisplay(to.code),
    to_account_name: to.name,
    status: entry.status,
    created_at: entry.created_at,
  };
}

export async function listCashTransfers(opts: {
  companyId: string;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
  offset?: number;
}): Promise<{ rows: CashTransferRow[]; total: number }> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);
  const offsetN = Math.max(opts.offset ?? 0, 0);

  const params: unknown[] = [opts.companyId];
  const where = [
    "e.deleted_at IS NULL",
    "e.company_id = $1::uuid",
    "e.source_document_type = 'cash_transfer'",
  ];

  if (opts.dateFrom) {
    params.push(opts.dateFrom);
    where.push(`e.entry_date >= $${params.length}::date`);
  }
  if (opts.dateTo) {
    params.push(opts.dateTo);
    where.push(`e.entry_date <= $${params.length}::date`);
  }
  if (opts.search?.trim()) {
    params.push(`%${opts.search.trim()}%`);
    where.push(
      `(e.entry_no ILIKE $${params.length} OR COALESCE(e.description,'') ILIKE $${params.length})`
    );
  }

  params.push(limit);
  const limPh = `$${params.length}`;
  params.push(offsetN);
  const offPh = `$${params.length}`;

  type Row = {
    id: string;
    entry_no: string;
    entry_date: string;
    description: string | null;
    status: string;
    created_at: string;
    amount: string;
    from_account_id: string;
    from_account_code: string;
    from_account_name: string;
    to_account_id: string;
    to_account_code: string;
    to_account_name: string;
    _total: number;
  };

  const rows = await query<Row>(
    `SELECT
       e.id,
       e.entry_no,
       e.entry_date::text AS entry_date,
       e.description,
       e.status,
       e.created_at,
       debit_line.amount::text AS amount,
       from_acc.id AS from_account_id,
       from_acc.code AS from_account_code,
       from_acc.name AS from_account_name,
       to_acc.id AS to_account_id,
       to_acc.code AS to_account_code,
       to_acc.name AS to_account_name,
       COUNT(*) OVER()::int AS _total
     FROM accounting.journal_entries e
     JOIN accounting.journal_entry_lines debit_line
       ON debit_line.entry_id = e.id AND debit_line.entry_side = 'DEBIT'
     JOIN accounting.chart_of_accounts to_acc
       ON to_acc.id = debit_line.account_id AND to_acc.is_cash_bank = true
     JOIN accounting.journal_entry_lines credit_line
       ON credit_line.entry_id = e.id AND credit_line.entry_side = 'CREDIT'
     JOIN accounting.chart_of_accounts from_acc
       ON from_acc.id = credit_line.account_id AND from_acc.is_cash_bank = true
     WHERE ${where.join(" AND ")}
       AND debit_line.account_id <> credit_line.account_id
     ORDER BY e.entry_date DESC, e.entry_no DESC
     LIMIT ${limPh} OFFSET ${offPh}`,
    params
  );

  return {
    rows: rows.map((r) => ({
      id: r.id,
      entry_no: r.entry_no,
      entry_date: String(r.entry_date).slice(0, 10),
      description: r.description,
      amount: Number(r.amount) || 0,
      from_account_id: r.from_account_id,
      from_account_code: formatAccountCodeDisplay(r.from_account_code),
      from_account_name: r.from_account_name,
      to_account_id: r.to_account_id,
      to_account_code: formatAccountCodeDisplay(r.to_account_code),
      to_account_name: r.to_account_name,
      status: r.status,
      created_at: r.created_at,
    })),
    total: Number(rows[0]?._total ?? 0),
  };
}
