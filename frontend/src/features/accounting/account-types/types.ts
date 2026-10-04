export interface AccountTypeItem {
  id: string;
  code: string;
  name: string;
  normal_balance: "DEBIT" | "CREDIT";
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at?: string | null;
}

export interface AccountTypePayload {
  code: string;
  name: string;
  normal_balance: "DEBIT" | "CREDIT";
  sort_order?: number;
  is_active?: boolean;
}
