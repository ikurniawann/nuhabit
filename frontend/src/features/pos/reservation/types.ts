export type ReservationStatus =
  | "pending"
  | "confirmed"
  | "seated"
  | "completed"
  | "cancelled"
  | "no_show";

export type OrderType = "dine_in" | "takeaway" | "delivery";

export interface ReservationRow {
  id: string;
  table_id: string | null;
  customer_id: string | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  reservation_date: string;
  time_slot: string;
  duration_minutes?: number | null;
  pax_count: number;
  special_requests?: string | null;
  deposit_amount?: number | string | null;
  notes?: string | null;
  status: ReservationStatus;
  /** Nomor antrian per tanggal (W-xx) — null utk baris sebelum fitur ini */
  queue_number?: number | null;
  table?: { table_number?: string | null } | null;
  customer?: { name?: string | null; phone?: string | null } | null;
}

export interface ReservationCustomer {
  id: string;
  name?: string | null;
  phone: string;
  visit_count?: number | null;
}

export interface ReservationTable {
  id: string;
  table_number?: string | null;
  label?: string | null;
  name?: string | null;
  capacity?: number;
  floor?: string | null;
  status?: string | null;
  is_active?: boolean;
}

export interface ReservationListParams {
  date: string;
  status?: ReservationStatus | "all";
}

export interface CreateReservationPayload {
  table_id: string | null;
  customer_id: string | null;
  customer_name: string;
  customer_phone: string;
  reservation_date: string;
  time_slot: string;
  pax_count: number;
  special_requests: string;
  deposit_amount: number;
  notes: string;
}
