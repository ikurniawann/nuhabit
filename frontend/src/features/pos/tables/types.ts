export type PosTableStatus =
  | "available"
  | "occupied"
  | "reserved"
  | "maintenance";

export type PosTableRow = {
  id: string;
  table_number: string;
  name?: string | null;
  label?: string | null;
  capacity: number;
  floor?: string | null;
  area?: string | null;
  status: string;
  qr_code?: string | null;
  notes?: string | null;
  is_active: boolean;
  active_order?: {
    id: string;
    order_number?: string;
    status?: string;
    payment_status?: string;
    total_amount: number;
  } | null;
  pos_x?: number | null;
  pos_y?: number | null;
};

export type PosTablePayload = {
  table_number: string;
  name?: string | null;
  floor?: string | null;
  area?: string | null;
  capacity: number;
  status: PosTableStatus;
  qr_code?: string | null;
  notes?: string | null;
  is_active: boolean;
};
