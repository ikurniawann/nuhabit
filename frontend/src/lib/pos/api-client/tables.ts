import { fetchAPI, toQueryString, type ApiResult } from "./http";

// Meja restoran.
export interface PosTable {
  id: string;
  table_number: string;
  name: string;
  label: string;
  capacity: number;
  floor?: string | null;
  area?: string | null;
  status: 'available' | 'occupied' | 'billing' | 'reserved' | 'maintenance' | string;
  qr_code?: string | null;
  is_active: boolean;
  pos_x?: number | null;
  pos_y?: number | null;
  active_order?: {
    id: string;
    order_number?: string;
    status?: string;
    payment_status?: string;
    total_amount: number;
    pre_settled_at?: string | null;
    checkout_id?: string | null;
    sold_from?: string | null;
  } | null;
  active_orders?: Array<{
    id: string;
    order_number?: string;
    status?: string;
    payment_status?: string;
    total_amount: number;
    pre_settled_at?: string | null;
    checkout_id?: string | null;
    sold_from?: string | null;
  }>;
  open_checkouts?: Array<{
    id: string;
    checkout_number?: string | null;
    payment_status?: string | null;
    total_amount: number;
  }>;
  bill_count?: number;
  /** Jumlah tamu duduk di order aktif meja (0 = belum tercatat). */
  guest_count?: number;
}

export async function getPOSTables(params?: { include_inactive?: boolean }) {
  return fetchAPI<ApiResult<PosTable[]>>(`/tables${toQueryString(params)}`);
}
