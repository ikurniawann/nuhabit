export type { MovementRow } from "@/lib/inventory/stock-queries";

export interface MovementFilters {
  raw_material_id: string;
  warehouse_id: string;
  tipe: string;
  reference_type: string;
  reference: string;
  date_from: string;
  date_to: string;
}
