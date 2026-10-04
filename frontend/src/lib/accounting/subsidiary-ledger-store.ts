import { query, queryOne } from "@/lib/db";

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

export const SUBSIDIARY_KINDS = ["AP", "AR"] as const;
export type SubsidiaryKind = (typeof SUBSIDIARY_KINDS)[number];

export type SubsidiaryPartyOption = {
  party_key: string;
  party_name: string;
  outstanding: number;
  invoice_count: number;
};

export type SubsidiaryLedgerLine = {
  line_id: string;
  entry_date: string;
  doc_type: "invoice" | "payment" | "receipt";
  doc_no: string;
  description: string | null;
  debit: number;
  credit: number;
  running_balance: number;
  source_id: string;
};

export type SubsidiaryLedgerReport = {
  kind: SubsidiaryKind;
  party_key: string;
  party_name: string;
  date_from: string | null;
  date_to: string | null;
  opening_balance: number;
  total_debit: number;
  total_credit: number;
  closing_balance: number;
  lines: SubsidiaryLedgerLine[];
};

function parseApPartyKey(key: string): {
  vendorId: string | null;
  supplierId: string | null;
} {
  if (key.startsWith("vendor:")) {
    return { vendorId: key.slice(7), supplierId: null };
  }
  if (key.startsWith("supplier:")) {
    return { vendorId: null, supplierId: key.slice(9) };
  }
  return { vendorId: null, supplierId: null };
}

/** List parties with current outstanding (AP vendors / AR customers). */
export async function listSubsidiaryParties(
  companyId: string,
  kind: SubsidiaryKind
): Promise<SubsidiaryPartyOption[]> {
  if (kind === "AP") {
    const rows = await query<{
      party_key: string;
      party_name: string;
      outstanding: string;
      invoice_count: string;
    }>(
      `SELECT
         CASE
           WHEN i.vendor_id IS NOT NULL THEN 'vendor:' || i.vendor_id::text
           ELSE 'supplier:' || i.supplier_id::text
         END AS party_key,
         COALESCE(v.name, s.nama_supplier, 'Vendor') AS party_name,
         SUM(
           GREATEST(
             i.total_amount - COALESCE((
               SELECT SUM(a.amount)
                 FROM accounting.ap_payment_allocations a
                 JOIN accounting.ap_payments p ON p.id = a.payment_id
                WHERE a.invoice_id = i.id
                  AND p.deleted_at IS NULL
                  AND p.status = 'POSTED'
             ), 0),
             0
           )
         )::text AS outstanding,
         COUNT(*)::text AS invoice_count
       FROM accounting.ap_invoices i
       LEFT JOIN purchasing.vendors v ON v.id = i.vendor_id
       LEFT JOIN purchasing.suppliers s ON s.id = i.supplier_id
       WHERE i.deleted_at IS NULL
         AND i.status = 'POSTED'
         AND i.company_id = $1::uuid
         AND (i.vendor_id IS NOT NULL OR i.supplier_id IS NOT NULL)
       GROUP BY 1, 2
       ORDER BY party_name ASC`,
      [companyId]
    );
    return rows.map((r) => ({
      party_key: r.party_key,
      party_name: r.party_name,
      outstanding: round2(Number(r.outstanding) || 0),
      invoice_count: Number(r.invoice_count) || 0,
    }));
  }

  const rows = await query<{
    party_key: string;
    party_name: string;
    outstanding: string;
    invoice_count: string;
  }>(
    `SELECT
       COALESCE(NULLIF(TRIM(i.customer_name), ''), 'Customer') AS party_key,
       COALESCE(NULLIF(TRIM(i.customer_name), ''), 'Customer') AS party_name,
       SUM(
         GREATEST(
           i.total_amount - COALESCE((
             SELECT SUM(a.amount)
               FROM accounting.ar_receipt_allocations a
               JOIN accounting.ar_receipts r ON r.id = a.receipt_id
              WHERE a.invoice_id = i.id
                AND r.deleted_at IS NULL
                AND r.status = 'POSTED'
           ), 0),
           0
         )
       )::text AS outstanding,
       COUNT(*)::text AS invoice_count
     FROM accounting.ar_invoices i
     WHERE i.deleted_at IS NULL
       AND i.status = 'POSTED'
       AND i.company_id = $1::uuid
     GROUP BY 1, 2
     ORDER BY party_name ASC`,
    [companyId]
  );
  return rows.map((r) => ({
    party_key: r.party_key,
    party_name: r.party_name,
    outstanding: round2(Number(r.outstanding) || 0),
    invoice_count: Number(r.invoice_count) || 0,
  }));
}

type RawMove = {
  line_id: string;
  entry_date: string;
  doc_type: "invoice" | "payment" | "receipt";
  doc_no: string;
  description: string | null;
  debit: number;
  credit: number;
  source_id: string;
};

async function apOpening(
  companyId: string,
  vendorId: string | null,
  supplierId: string | null,
  beforeDate: string
): Promise<number> {
  const row = await queryOne<{ bal: string }>(
    `SELECT (
       COALESCE((
         SELECT SUM(i.total_amount)
           FROM accounting.ap_invoices i
          WHERE i.deleted_at IS NULL AND i.status = 'POSTED'
            AND i.company_id = $1::uuid
            AND i.invoice_date < $2::date
            AND (
              ($3::uuid IS NOT NULL AND i.vendor_id = $3::uuid)
              OR ($4::uuid IS NOT NULL AND i.supplier_id = $4::uuid)
            )
       ), 0)
       -
       COALESCE((
         SELECT SUM(a.amount)
           FROM accounting.ap_payment_allocations a
           JOIN accounting.ap_payments p ON p.id = a.payment_id
           JOIN accounting.ap_invoices i ON i.id = a.invoice_id
          WHERE p.deleted_at IS NULL AND p.status = 'POSTED'
            AND i.deleted_at IS NULL AND i.status = 'POSTED'
            AND i.company_id = $1::uuid
            AND p.payment_date < $2::date
            AND (
              ($3::uuid IS NOT NULL AND i.vendor_id = $3::uuid)
              OR ($4::uuid IS NOT NULL AND i.supplier_id = $4::uuid)
            )
       ), 0)
     )::text AS bal`,
    [companyId, beforeDate, vendorId, supplierId]
  );
  return round2(Number(row?.bal || 0));
}

async function arOpening(
  companyId: string,
  customerName: string,
  beforeDate: string
): Promise<number> {
  const row = await queryOne<{ bal: string }>(
    `SELECT (
       COALESCE((
         SELECT SUM(i.total_amount)
           FROM accounting.ar_invoices i
          WHERE i.deleted_at IS NULL AND i.status = 'POSTED'
            AND i.company_id = $1::uuid
            AND i.invoice_date < $2::date
            AND COALESCE(NULLIF(TRIM(i.customer_name), ''), 'Customer') = $3
       ), 0)
       -
       COALESCE((
         SELECT SUM(a.amount)
           FROM accounting.ar_receipt_allocations a
           JOIN accounting.ar_receipts r ON r.id = a.receipt_id
           JOIN accounting.ar_invoices i ON i.id = a.invoice_id
          WHERE r.deleted_at IS NULL AND r.status = 'POSTED'
            AND i.deleted_at IS NULL AND i.status = 'POSTED'
            AND i.company_id = $1::uuid
            AND r.receipt_date < $2::date
            AND COALESCE(NULLIF(TRIM(i.customer_name), ''), 'Customer') = $3
       ), 0)
     )::text AS bal`,
    [companyId, beforeDate, customerName]
  );
  return round2(Number(row?.bal || 0));
}

export async function getSubsidiaryLedger(opts: {
  companyId: string;
  kind: SubsidiaryKind;
  partyKey: string;
  dateFrom?: string;
  dateTo?: string;
}): Promise<SubsidiaryLedgerReport | null> {
  const dateFrom = opts.dateFrom || null;
  const dateTo = opts.dateTo || null;

  if (opts.kind === "AP") {
    const { vendorId, supplierId } = parseApPartyKey(opts.partyKey);
    if (!vendorId && !supplierId) return null;

    const nameRow = await queryOne<{ party_name: string }>(
      vendorId
        ? `SELECT name AS party_name FROM purchasing.vendors WHERE id = $1::uuid`
        : `SELECT nama_supplier AS party_name FROM purchasing.suppliers WHERE id = $1::uuid`,
      [vendorId || supplierId]
    );
    const partyName = nameRow?.party_name || "Vendor";

    let opening = 0;
    if (dateFrom) {
      opening = await apOpening(opts.companyId, vendorId, supplierId, dateFrom);
    }

    const invParams: unknown[] = [opts.companyId, vendorId, supplierId];
    const invWhere = [
      "i.deleted_at IS NULL",
      "i.status = 'POSTED'",
      "i.company_id = $1::uuid",
      `(
         ($2::uuid IS NOT NULL AND i.vendor_id = $2::uuid)
         OR ($3::uuid IS NOT NULL AND i.supplier_id = $3::uuid)
       )`,
    ];
    if (dateFrom) {
      invParams.push(dateFrom);
      invWhere.push(`i.invoice_date >= $${invParams.length}::date`);
    }
    if (dateTo) {
      invParams.push(dateTo);
      invWhere.push(`i.invoice_date <= $${invParams.length}::date`);
    }

    const invoices = await query<{
      id: string;
      invoice_no: string;
      invoice_date: string;
      total_amount: string;
      description: string | null;
    }>(
      `SELECT i.id, i.invoice_no, i.invoice_date::text AS invoice_date,
              i.total_amount::text, i.description
         FROM accounting.ap_invoices i
        WHERE ${invWhere.join(" AND ")}
        ORDER BY i.invoice_date ASC, i.invoice_no ASC`,
      invParams
    );

    const payParams: unknown[] = [opts.companyId, vendorId, supplierId];
    const payWhere = [
      "p.deleted_at IS NULL",
      "p.status = 'POSTED'",
      "i.deleted_at IS NULL",
      "i.status = 'POSTED'",
      "i.company_id = $1::uuid",
      `(
         ($2::uuid IS NOT NULL AND i.vendor_id = $2::uuid)
         OR ($3::uuid IS NOT NULL AND i.supplier_id = $3::uuid)
       )`,
    ];
    if (dateFrom) {
      payParams.push(dateFrom);
      payWhere.push(`p.payment_date >= $${payParams.length}::date`);
    }
    if (dateTo) {
      payParams.push(dateTo);
      payWhere.push(`p.payment_date <= $${payParams.length}::date`);
    }

    const payments = await query<{
      id: string;
      payment_no: string;
      payment_date: string;
      amount: string;
      invoice_no: string;
    }>(
      `SELECT a.id, p.payment_no, p.payment_date::text AS payment_date,
              a.amount::text, i.invoice_no
         FROM accounting.ap_payment_allocations a
         JOIN accounting.ap_payments p ON p.id = a.payment_id
         JOIN accounting.ap_invoices i ON i.id = a.invoice_id
        WHERE ${payWhere.join(" AND ")}
        ORDER BY p.payment_date ASC, p.payment_no ASC`,
      payParams
    );

    const moves: RawMove[] = [
      ...invoices.map((i) => ({
        line_id: `inv-${i.id}`,
        entry_date: i.invoice_date,
        doc_type: "invoice" as const,
        doc_no: i.invoice_no,
        description: i.description,
        debit: round2(Number(i.total_amount) || 0),
        credit: 0,
        source_id: i.id,
      })),
      ...payments.map((p) => ({
        line_id: `pay-${p.id}`,
        entry_date: p.payment_date,
        doc_type: "payment" as const,
        doc_no: p.payment_no,
        description: `Bayar ${p.invoice_no}`,
        debit: 0,
        credit: round2(Number(p.amount) || 0),
        source_id: p.id,
      })),
    ].sort((a, b) => {
      if (a.entry_date !== b.entry_date) return a.entry_date.localeCompare(b.entry_date);
      return a.doc_no.localeCompare(b.doc_no);
    });

    return buildReport({
      kind: "AP",
      partyKey: opts.partyKey,
      partyName,
      dateFrom,
      dateTo,
      opening,
      moves,
    });
  }

  // AR — party_key is customer name
  const customerName = opts.partyKey;
  let opening = 0;
  if (dateFrom) {
    opening = await arOpening(opts.companyId, customerName, dateFrom);
  }

  const invParams: unknown[] = [opts.companyId, customerName];
  const invWhere = [
    "i.deleted_at IS NULL",
    "i.status = 'POSTED'",
    "i.company_id = $1::uuid",
    "COALESCE(NULLIF(TRIM(i.customer_name), ''), 'Customer') = $2",
  ];
  if (dateFrom) {
    invParams.push(dateFrom);
    invWhere.push(`i.invoice_date >= $${invParams.length}::date`);
  }
  if (dateTo) {
    invParams.push(dateTo);
    invWhere.push(`i.invoice_date <= $${invParams.length}::date`);
  }

  const invoices = await query<{
    id: string;
    invoice_no: string;
    invoice_date: string;
    total_amount: string;
    description: string | null;
  }>(
    `SELECT i.id, i.invoice_no, i.invoice_date::text AS invoice_date,
            i.total_amount::text, i.description
       FROM accounting.ar_invoices i
      WHERE ${invWhere.join(" AND ")}
      ORDER BY i.invoice_date ASC, i.invoice_no ASC`,
    invParams
  );

  const rcpParams: unknown[] = [opts.companyId, customerName];
  const rcpWhere = [
    "r.deleted_at IS NULL",
    "r.status = 'POSTED'",
    "i.deleted_at IS NULL",
    "i.status = 'POSTED'",
    "i.company_id = $1::uuid",
    "COALESCE(NULLIF(TRIM(i.customer_name), ''), 'Customer') = $2",
  ];
  if (dateFrom) {
    rcpParams.push(dateFrom);
    rcpWhere.push(`r.receipt_date >= $${rcpParams.length}::date`);
  }
  if (dateTo) {
    rcpParams.push(dateTo);
    rcpWhere.push(`r.receipt_date <= $${rcpParams.length}::date`);
  }

  const receipts = await query<{
    id: string;
    receipt_no: string;
    receipt_date: string;
    amount: string;
    invoice_no: string;
  }>(
    `SELECT a.id, r.receipt_no, r.receipt_date::text AS receipt_date,
            a.amount::text, i.invoice_no
       FROM accounting.ar_receipt_allocations a
       JOIN accounting.ar_receipts r ON r.id = a.receipt_id
       JOIN accounting.ar_invoices i ON i.id = a.invoice_id
      WHERE ${rcpWhere.join(" AND ")}
      ORDER BY r.receipt_date ASC, r.receipt_no ASC`,
    rcpParams
  );

  const moves: RawMove[] = [
    ...invoices.map((i) => ({
      line_id: `inv-${i.id}`,
      entry_date: i.invoice_date,
      doc_type: "invoice" as const,
      doc_no: i.invoice_no,
      description: i.description,
      debit: round2(Number(i.total_amount) || 0),
      credit: 0,
      source_id: i.id,
    })),
    ...receipts.map((r) => ({
      line_id: `rcp-${r.id}`,
      entry_date: r.receipt_date,
      doc_type: "receipt" as const,
      doc_no: r.receipt_no,
      description: `Terima ${r.invoice_no}`,
      debit: 0,
      credit: round2(Number(r.amount) || 0),
      source_id: r.id,
    })),
  ].sort((a, b) => {
    if (a.entry_date !== b.entry_date) return a.entry_date.localeCompare(b.entry_date);
    return a.doc_no.localeCompare(b.doc_no);
  });

  return buildReport({
    kind: "AR",
    partyKey: opts.partyKey,
    partyName: customerName,
    dateFrom,
    dateTo,
    opening,
    moves,
  });
}

function buildReport(opts: {
  kind: SubsidiaryKind;
  partyKey: string;
  partyName: string;
  dateFrom: string | null;
  dateTo: string | null;
  opening: number;
  moves: RawMove[];
}): SubsidiaryLedgerReport {
  let running = opts.opening;
  let totalDebit = 0;
  let totalCredit = 0;
  const lines: SubsidiaryLedgerLine[] = opts.moves.map((m) => {
    totalDebit = round2(totalDebit + m.debit);
    totalCredit = round2(totalCredit + m.credit);
    running = round2(running + m.debit - m.credit);
    return {
      ...m,
      running_balance: running,
    };
  });

  return {
    kind: opts.kind,
    party_key: opts.partyKey,
    party_name: opts.partyName,
    date_from: opts.dateFrom,
    date_to: opts.dateTo,
    opening_balance: opts.opening,
    total_debit: totalDebit,
    total_credit: totalCredit,
    closing_balance: running,
    lines,
  };
}
