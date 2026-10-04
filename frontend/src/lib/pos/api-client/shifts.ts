import { fetchAPI } from "./http";

// Shift kasir.
// ===== Shift Management =====

export interface PosShift {
  id: string;
  shift_number: string;
  cashier_id: string;
  branch_id?: string;
  opened_at: string;
  closed_at?: string;
  opened_by?: string;
  closed_by?: string;
  opening_cash: number;
  closing_cash?: number;
  expected_cash?: number;
  variance?: number;
  total_orders: number;
  total_sales: number;
  total_refunds: number;
  total_cash_sales: number;
  total_qris_sales: number;
  total_debit_sales: number;
  total_credit_sales: number;
  total_ark_coin_sales: number;
  notes?: string;
  status: 'active' | 'closed' | 'cancelled';
}

export interface ShiftSummary {
  total_orders: number;
  total_sales: number;
  opening_cash: number;
  expected_cash: number;
  closing_cash: number;
  variance: number;
  method_breakdown: {
    cash: number;
    qris: number;
    debit: number;
    credit: number;
    ark_coin: number;
  };
}

export async function getCurrentShift(cashierId: string) {
  return fetchAPI<{ success: boolean; data?: PosShift; error?: string }>(
    `/shifts/current?cashier_id=${encodeURIComponent(cashierId)}`
  );
}

export async function openShift(payload: { cashier_id: string; opening_cash: number; notes?: string }) {
  return fetchAPI<{ success: boolean; data?: PosShift; error?: string }>('/shifts', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function closeShift(
  shiftId: string,
  payload: { closing_cash: number; notes?: string }
) {
  return fetchAPI<{ success: boolean; data?: PosShift; summary?: ShiftSummary; error?: string }>(
    `/shifts/${shiftId}/close`,
    { method: 'PATCH', body: JSON.stringify(payload) }
  );
}
