export type PrintJobStatus = "pending" | "printing" | "printed" | "failed" | "cancelled";

export type PrintJobAction = "mark_printing" | "mark_printed" | "mark_failed" | "retry";

export type PrintJobOrder = {
  order_number?: string | null;
  order_type?: string | null;
  ordered_at?: string | null;
  status?: string | null;
  payment_status?: string | null;
};

export type PrintJobPayloadItem = {
  product_name?: string;
  quantity?: number;
  notes?: string;
};

export type PrintJobPayload = {
  items?: PrintJobPayloadItem[];
};

export type PrintJob = {
  id: string;
  order_id: string;
  station: string;
  job_type: string;
  status: PrintJobStatus;
  payload?: PrintJobPayload | null;
  attempts: number;
  last_error?: string | null;
  requested_at: string;
  printed_at?: string | null;
  order?: PrintJobOrder | null;
};

export interface PrintJobListParams {
  station?: string;
  status?: string;
  limit?: number;
}
