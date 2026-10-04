export type CashBankAccountItem = {
  id: string;
  code: string;
  code_display: string;
  name: string;
  account_type_code: string | null;
  normal_balance: "DEBIT" | "CREDIT";
  balance: number;
  movement_count: number;
};

export type CashBankLedgerLineItem = {
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

export type CashBankLedgerItem = {
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
  lines: CashBankLedgerLineItem[];
};

export type CashBankLedgerFilters = {
  date_from?: string;
  date_to?: string;
};

export type CashMovementKind = "cash_in" | "cash_out";

export type CashMovementItem = {
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

export type PostableAccountOptionItem = {
  id: string;
  code: string;
  code_display: string;
  name: string;
  is_cash_bank: boolean;
};

export type CreateCashMovementPayload = {
  entry_date: string;
  amount: number;
  cash_account_id: string;
  offset_account_id: string;
  description?: string | null;
  memo?: string | null;
};

export type CashTransferItem = {
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

export type CreateCashTransferPayload = {
  entry_date: string;
  amount: number;
  from_account_id: string;
  to_account_id: string;
  description?: string | null;
  memo?: string | null;
};
