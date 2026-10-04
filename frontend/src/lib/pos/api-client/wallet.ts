import { fetchAPI, toQueryString, type ApiResult } from "./http";

// Dashboard & top-up ARK.
// ============ DASHBOARD ============

export async function getDashboardStats(
  period?: 'today' | 'week' | 'month',
  range?: { from: string; to: string }
) {
  if (range) {
    return fetchAPI<ApiResult<unknown>>(
      `/dashboard?period=custom&date_from=${encodeURIComponent(range.from)}&date_to=${encodeURIComponent(range.to)}`
    );
  }
  return fetchAPI<ApiResult<unknown>>(`/dashboard?period=${period || 'today'}`);
}

// ============ TOPUP ============

export async function processTopup(data: {
  customer_id: string;
  amount: number;
  payment_method?: 'qris' | 'credit' | 'cash' | 'foc';
  supervisor_pin?: string;
  package_id?: string;
}) {
  return fetchAPI<ApiResult<unknown>>('/topup', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function getTopupStatus(topupId: string) {
  return fetchAPI<ApiResult<unknown>>(`/topup/${topupId}/status`);
}

export async function getTopupHistory(params?: { customer_id?: string; limit?: number }) {
  return fetchAPI<ApiResult<unknown[]>>(`/topup${toQueryString({ ...params, limit: params?.limit || undefined })}`);
}

export async function cancelTopup(topupId: string) {
  return fetchAPI<ApiResult<unknown>>(`/topup/${topupId}/cancel`, {
    method: 'POST',
  });
}
