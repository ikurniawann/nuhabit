export type { ShiftPayload } from "@/lib/hris/shifts-view";

/** Master shift kerja (Go /api/hris/shifts). */
export interface ShiftRow {
  id: string;
  name: string;
  start_time: string;
  end_time: string;
  break_minutes: number;
  late_tolerance_minutes: number;
  is_overnight: boolean;
  is_active: boolean;
  sort_order: number;
}
