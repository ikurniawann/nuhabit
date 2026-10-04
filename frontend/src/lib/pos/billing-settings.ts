export type ChargeKind = "tax" | "service" | "fee" | "rounding";
export type CalcMethod = "percent" | "fixed" | "round_nearest" | "round_up";
export type ChargeBase = "subtotal_after_discount" | "subtotal_plus_fees";

export type BillingCharge = {
  id?: string | null;
  code: string;
  name: string;
  charge_kind: ChargeKind;
  calc_method: CalcMethod;
  rate: number;
  amount: number;
  apply_order: number;
  is_enabled: boolean;
  is_optional: boolean;
  base: ChargeBase;
};

export type BillingProfile = {
  id: string;
  branch_id: string | null;
  warehouse_id: string | null;
  name: string;
  is_active: boolean;
  scope: "system" | "branch" | "stall";
  charges: BillingCharge[];
};

export type ChargeBreakdownLine = {
  code: string;
  name: string;
  kind: ChargeKind;
  amount: number;
  /** Utk label struk "Tax (10%)" — hanya terisi bila charge percent. */
  rate?: number;
  calc_method?: CalcMethod;
};

export type BillChargesResult = {
  tax_amount: number;
  service_charge_amount: number;
  other_charges_amount: number;
  rounding_adjustment: number;
  total: number;
  breakdown: ChargeBreakdownLine[];
};

export const SYSTEM_BILLING_PROFILE_ID = "b0000000-0000-4000-8000-000000000001";

export const DEFAULT_BILLING_CHARGES: BillingCharge[] = [
  {
    id: "b0000000-0000-4000-8000-000000000011",
    code: "TAX",
    name: "Tax",
    charge_kind: "tax",
    calc_method: "percent",
    rate: 10,
    amount: 0,
    apply_order: 200,
    is_enabled: true,
    is_optional: true,
    base: "subtotal_after_discount",
  },
  {
    id: "b0000000-0000-4000-8000-000000000012",
    code: "SERVICE",
    name: "Service Charge",
    charge_kind: "service",
    calc_method: "percent",
    rate: 0,
    amount: 0,
    apply_order: 100,
    is_enabled: false,
    is_optional: true,
    base: "subtotal_after_discount",
  },
  {
    id: "b0000000-0000-4000-8000-000000000013",
    code: "ROUND",
    name: "Rounding",
    charge_kind: "rounding",
    calc_method: "round_nearest",
    rate: 0,
    amount: 0,
    apply_order: 900,
    is_enabled: false,
    is_optional: false,
    base: "subtotal_plus_fees",
  },
];

export const DEFAULT_BILLING_PROFILE: BillingProfile = {
  id: SYSTEM_BILLING_PROFILE_ID,
  branch_id: null,
  warehouse_id: null,
  name: "System Default",
  is_active: true,
  scope: "system",
  charges: DEFAULT_BILLING_CHARGES,
};

function toNumber(value: unknown, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toBool(value: unknown, fallback = false) {
  if (typeof value === "boolean") return value;
  if (value == null) return fallback;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1") return true;
    if (normalized === "false" || normalized === "0") return false;
  }
  return Boolean(value);
}

function asChargeKind(raw: unknown): ChargeKind {
  const value = String(raw || "").toLowerCase();
  if (value === "tax" || value === "service" || value === "fee" || value === "rounding") {
    return value;
  }
  return "fee";
}

function asCalcMethod(raw: unknown): CalcMethod {
  const value = String(raw || "").toLowerCase();
  if (
    value === "percent" ||
    value === "fixed" ||
    value === "round_nearest" ||
    value === "round_up"
  ) {
    return value;
  }
  return "percent";
}

function asChargeBase(raw: unknown): ChargeBase {
  return String(raw || "") === "subtotal_plus_fees"
    ? "subtotal_plus_fees"
    : "subtotal_after_discount";
}

export function normalizeBillingCharge(row: Record<string, unknown> | null | undefined): BillingCharge {
  if (!row) {
    return { ...DEFAULT_BILLING_CHARGES[0]! };
  }
  return {
    id: row.id != null ? String(row.id) : null,
    code: String(row.code || "").trim().toUpperCase() || "FEE",
    name: String(row.name || row.code || "Charge").trim() || "Charge",
    charge_kind: asChargeKind(row.charge_kind),
    calc_method: asCalcMethod(row.calc_method),
    rate: Math.max(0, toNumber(row.rate)),
    amount: Math.max(0, toNumber(row.amount)),
    apply_order: Math.floor(toNumber(row.apply_order, 100)),
    is_enabled: toBool(row.is_enabled, true),
    is_optional: toBool(row.is_optional, false),
    base: asChargeBase(row.base),
  };
}

export function normalizeBillingProfile(
  row: Record<string, unknown> | null | undefined,
  charges: BillingCharge[] = []
): BillingProfile {
  if (!row) {
    return {
      ...DEFAULT_BILLING_PROFILE,
      charges: charges.length > 0 ? charges : [...DEFAULT_BILLING_CHARGES],
    };
  }

  const branchId = row.branch_id != null ? String(row.branch_id) : null;
  const warehouseId = row.warehouse_id != null ? String(row.warehouse_id) : null;
  const scope: BillingProfile["scope"] = !branchId
    ? "system"
    : warehouseId
      ? "stall"
      : "branch";

  return {
    id: String(row.id),
    branch_id: branchId,
    warehouse_id: warehouseId,
    name: String(row.name || "Billing Profile"),
    is_active: toBool(row.is_active, true),
    scope,
    charges: charges.length > 0 ? charges : [],
  };
}

function resolveBase(
  charge: BillingCharge,
  subtotalAfterDiscount: number,
  running: number
) {
  return charge.base === "subtotal_plus_fees" ? running : subtotalAfterDiscount;
}

function calcLineAmount(
  charge: BillingCharge,
  subtotalAfterDiscount: number,
  running: number
): number {
  if (charge.charge_kind === "rounding") {
    const step = Math.max(0, Math.round(charge.rate));
    if (step <= 0) return 0;
    const target =
      charge.calc_method === "round_up"
        ? Math.ceil(running / step) * step
        : Math.round(running / step) * step;
    return target - running;
  }

  if (charge.calc_method === "fixed") {
    return Math.round(Math.max(0, charge.amount));
  }

  const base = resolveBase(charge, subtotalAfterDiscount, running);
  return Math.round((base * Math.max(0, charge.rate)) / 100);
}

/**
 * Pure bill calculator. Optional charges apply only when their code is in
 * `enabledOptionalCodes` (or when not optional).
 */
export function calculateBillCharges(input: {
  subtotalAfterDiscount: number;
  charges: BillingCharge[];
  enabledOptionalCodes?: Iterable<string>;
}): BillChargesResult {
  const subtotalAfterDiscount = Math.max(0, Math.round(toNumber(input.subtotalAfterDiscount)));
  const enabledOptional = new Set(
    [...(input.enabledOptionalCodes ?? [])].map((code) => String(code).trim().toUpperCase())
  );

  const lines = [...input.charges]
    .filter((charge) => charge.is_enabled)
    .sort((a, b) => a.apply_order - b.apply_order || a.code.localeCompare(b.code));

  let running = subtotalAfterDiscount;
  let tax_amount = 0;
  let service_charge_amount = 0;
  let fee_amount = 0;
  let rounding_adjustment = 0;
  const breakdown: ChargeBreakdownLine[] = [];

  for (const charge of lines) {
    if (charge.is_optional && !enabledOptional.has(charge.code.toUpperCase())) {
      continue;
    }

    const amount = calcLineAmount(charge, subtotalAfterDiscount, running);
    if (charge.charge_kind === "rounding") {
      if (amount === 0) continue;
      rounding_adjustment += amount;
      running += amount;
      breakdown.push({
        code: charge.code,
        name: charge.name,
        kind: "rounding",
        amount,
        calc_method: charge.calc_method,
      });
      continue;
    }

    if (amount <= 0 && charge.calc_method !== "fixed") continue;
    if (amount === 0) continue;

    running += amount;
    if (charge.charge_kind === "tax") tax_amount += amount;
    else if (charge.charge_kind === "service") service_charge_amount += amount;
    else fee_amount += amount;

    breakdown.push({
      code: charge.code,
      name: charge.name,
      kind: charge.charge_kind,
      amount,
      rate: charge.calc_method === "percent" ? charge.rate : undefined,
      calc_method: charge.calc_method,
    });
  }

  return {
    tax_amount,
    service_charge_amount,
    other_charges_amount: fee_amount + rounding_adjustment,
    rounding_adjustment,
    total: running,
    breakdown,
  };
}

export function profileScopeLabel(scope: BillingProfile["scope"]) {
  if (scope === "stall") return "Override stall";
  if (scope === "branch") return "Default cabang";
  return "Default sistem";
}

/** TAX/SERVICE optional follow cashier toggles; other optionals default on. */
export function resolveEnabledOptionalCodes(
  charges: BillingCharge[],
  includeTax: boolean,
  includeService = true
): string[] {
  return charges
    .filter((charge) => charge.is_enabled && charge.is_optional)
    .filter((charge) => {
      if (charge.charge_kind === "tax") return includeTax;
      if (charge.charge_kind === "service") return includeService;
      return true;
    })
    .map((charge) => charge.code);
}

export function taxToggleLabel(charges: BillingCharge[]): string | null {
  const tax = charges.find(
    (charge) => charge.charge_kind === "tax" && charge.is_enabled && charge.is_optional
  );
  if (!tax) return null;
  if (tax.calc_method === "percent" && tax.rate > 0) {
    return `${tax.name} (${tax.rate}%)`;
  }
  return tax.name;
}

export function serviceToggleLabel(charges: BillingCharge[]): string | null {
  const service = charges.find(
    (charge) =>
      charge.charge_kind === "service" && charge.is_enabled && charge.is_optional
  );
  if (!service) return null;
  if (service.calc_method === "percent" && service.rate > 0) {
    return `${service.name} (${service.rate}%)`;
  }
  return service.name;
}
