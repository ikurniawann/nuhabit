export type {
  BillingCharge,
  BillingProfile,
  BillChargesResult,
  ChargeBreakdownLine,
  ChargeKind,
  CalcMethod,
  ChargeBase,
} from "@/lib/pos/billing-settings";

export type UpsertBillingProfilePayload = {
  id?: string | null;
  branch_id: string | null;
  warehouse_id: string | null;
  name: string;
  charges: Array<{
    code: string;
    name: string;
    charge_kind: "tax" | "service" | "fee" | "rounding";
    calc_method: "percent" | "fixed" | "round_nearest" | "round_up";
    rate: number;
    amount: number;
    apply_order: number;
    is_enabled: boolean;
    is_optional: boolean;
    base: "subtotal_after_discount" | "subtotal_plus_fees";
  }>;
};

export type BillingOptions = {
  branches: Array<{ id: string; name: string; code: string }>;
  warehouses: Array<{ id: string; name: string; code: string; branch_id: string }>;
  profiles: import("@/lib/pos/billing-settings").BillingProfile[];
};
