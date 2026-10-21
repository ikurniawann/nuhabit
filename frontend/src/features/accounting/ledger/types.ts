/** Bentuk respons Go /api/accounting/ledger/subsidiary. */

export type SubsidiaryKind = "AP" | "AR";

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
