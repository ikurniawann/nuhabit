// Aturan murni editor Tax & Service: baris biaya inti, validasi, payload simpan.
import { DEFAULT_BILLING_CHARGES, type BillingCharge, type BillingProfile } from "@/lib/pos/billing-settings";

export function emptyCharge(partial?: Partial<BillingCharge>): BillingCharge {
  return {
    code: "",
    name: "",
    charge_kind: "fee",
    calc_method: "fixed",
    rate: 0,
    amount: 0,
    apply_order: 50,
    is_enabled: true,
    is_optional: false,
    base: "subtotal_after_discount",
    ...partial,
  };
}

export const cloneCharges = (charges: BillingCharge[]) => charges.map((charge) => ({ ...charge }));

export function defaultCharge(kind: "tax" | "service"): BillingCharge {
  const found = DEFAULT_BILLING_CHARGES.find((c) => c.charge_kind === kind);
  return { ...(found ?? emptyCharge({ charge_kind: kind })) };
}

/** Pastikan TAX + SERVICE selalu ada di state UI. */
export function ensureCoreCharges(charges: BillingCharge[]): BillingCharge[] {
  const next = cloneCharges(charges);
  if (!next.some((c) => c.charge_kind === "tax")) next.push(defaultCharge("tax"));
  if (!next.some((c) => c.charge_kind === "service")) next.push(defaultCharge("service"));
  return next;
}

export function defaultProfileName(branchId: string, warehouseId: string) {
  if (warehouseId) return "Billing Stall";
  if (branchId) return "Billing Cabang";
  return "Default Sistem";
}

export function editingScopeLabel(branchId: string, warehouseId: string) {
  if (warehouseId) return "Override stall";
  if (branchId) return "Default cabang";
  return "Default sistem";
}

export type BillingEditorState = { profileId: string | null; profileName: string; charges: BillingCharge[] };

/** Isi editor dari profil yang berlaku untuk scope; tanpa profil = default sistem. */
export function editorStateFromProfile(
  profile: BillingProfile | null,
  scope: { branchId: string; warehouseId: string }
): BillingEditorState {
  if (!profile) {
    return {
      profileId: null,
      profileName: defaultProfileName(scope.branchId, scope.warehouseId),
      charges: ensureCoreCharges(DEFAULT_BILLING_CHARGES),
    };
  }
  return {
    profileId: profile.id,
    profileName: profile.name,
    charges: ensureCoreCharges(profile.charges.length > 0 ? profile.charges : DEFAULT_BILLING_CHARGES),
  };
}

/** Profil yang berlaku: override stall → default cabang → default sistem. */
export function matchBillingProfile(profiles: BillingProfile[], branchId: string, warehouseId: string) {
  const branch = branchId || null;
  const warehouse = warehouseId || null;
  if (branch && warehouse) {
    const stall = profiles.find((p) => p.branch_id === branch && p.warehouse_id === warehouse);
    if (stall) return stall;
  }
  if (branch) {
    const branchProfile = profiles.find((p) => p.branch_id === branch && !p.warehouse_id);
    if (branchProfile) return branchProfile;
  }
  return profiles.find((p) => !p.branch_id && !p.warehouse_id) ?? null;
}

export function nextFeeCharge(charges: BillingCharge[]): BillingCharge {
  return emptyCharge({
    code: `FEE${charges.filter((c) => c.charge_kind === "fee").length + 1}`,
    name: "Biaya unik",
    charge_kind: "fee",
    calc_method: "fixed",
    apply_order: 50,
  });
}

/** Validasi + normalisasi baris biaya untuk disimpan (kode huruf besar & unik). */
export function chargesForSave(
  charges: BillingCharge[]
): { ok: true; charges: BillingCharge[] } | { ok: false; error: string } {
  const ensured = ensureCoreCharges(charges);
  const codes = ensured.map((c) => c.code.trim().toUpperCase());
  if (codes.some((code) => !code)) return { ok: false, error: "Setiap biaya wajib punya uniqcode" };
  if (new Set(codes).size !== codes.length) return { ok: false, error: "Kode biaya harus unik" };
  return {
    ok: true,
    charges: ensured.map((charge) => ({
      code: charge.code.trim().toUpperCase(),
      name: charge.name.trim() || charge.code,
      charge_kind: charge.charge_kind,
      calc_method: charge.charge_kind === "tax" || charge.charge_kind === "service" ? "percent" : charge.calc_method,
      rate: Number(charge.rate) || 0,
      amount: Number(charge.amount) || 0,
      apply_order: Number(charge.apply_order) || 0,
      is_enabled: charge.is_enabled,
      is_optional: charge.is_optional,
      base: charge.base,
    })),
  };
}
