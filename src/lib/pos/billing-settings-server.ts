import "server-only";
import { query, queryOne } from "@/lib/db";
import {
  DEFAULT_BILLING_PROFILE,
  normalizeBillingCharge,
  normalizeBillingProfile,
  SYSTEM_BILLING_PROFILE_ID,
  type BillingCharge,
  type BillingProfile,
} from "@/lib/pos/billing-settings";

type ProfileRow = Record<string, unknown>;
type ChargeRow = Record<string, unknown>;

async function loadCharges(profileId: string): Promise<BillingCharge[]> {
  const rows = await query<ChargeRow>(
    `SELECT id, profile_id, code, name, charge_kind, calc_method, rate, amount,
            apply_order, is_enabled, is_optional, base
     FROM pos.pos_billing_charges
     WHERE profile_id = $1
     ORDER BY apply_order ASC, code ASC`,
    [profileId]
  );
  return rows.map((row) => normalizeBillingCharge(row));
}

async function loadProfileById(id: string): Promise<BillingProfile | null> {
  const row = await queryOne<ProfileRow>(
    `SELECT id, branch_id, warehouse_id, name, is_active
     FROM pos.pos_billing_profiles
     WHERE id = $1 AND is_active = true`,
    [id]
  );
  if (!row) return null;
  const charges = await loadCharges(String(row.id));
  return normalizeBillingProfile(row, charges);
}

/**
 * Resolve effective billing profile:
 * stall (branch+warehouse) → branch (warehouse NULL) → system default.
 */
export async function resolveBillingProfile(input: {
  branchId?: string | null;
  warehouseId?: string | null;
}): Promise<BillingProfile> {
  try {
    const branchId = input.branchId?.trim() || null;
    const warehouseId = input.warehouseId?.trim() || null;

    if (branchId && warehouseId) {
      const stall = await queryOne<ProfileRow>(
        `SELECT id, branch_id, warehouse_id, name, is_active
         FROM pos.pos_billing_profiles
         WHERE is_active = true
           AND branch_id = $1
           AND warehouse_id = $2
         LIMIT 1`,
        [branchId, warehouseId]
      );
      if (stall) {
        const charges = await loadCharges(String(stall.id));
        return normalizeBillingProfile(stall, charges);
      }
    }

    if (branchId) {
      const branch = await queryOne<ProfileRow>(
        `SELECT id, branch_id, warehouse_id, name, is_active
         FROM pos.pos_billing_profiles
         WHERE is_active = true
           AND branch_id = $1
           AND warehouse_id IS NULL
         LIMIT 1`,
        [branchId]
      );
      if (branch) {
        const charges = await loadCharges(String(branch.id));
        return normalizeBillingProfile(branch, charges);
      }
    }

    const system =
      (await loadProfileById(SYSTEM_BILLING_PROFILE_ID)) ??
      (await queryOne<ProfileRow>(
        `SELECT id, branch_id, warehouse_id, name, is_active
         FROM pos.pos_billing_profiles
         WHERE is_active = true
           AND branch_id IS NULL
           AND warehouse_id IS NULL
         ORDER BY created_at ASC
         LIMIT 1`
      ).then(async (row) => {
        if (!row) return null;
        const charges = await loadCharges(String(row.id));
        return normalizeBillingProfile(row, charges);
      }));

    return system ?? { ...DEFAULT_BILLING_PROFILE, charges: [...DEFAULT_BILLING_PROFILE.charges] };
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as { code?: string }).code === "42P01"
    ) {
      return { ...DEFAULT_BILLING_PROFILE, charges: [...DEFAULT_BILLING_PROFILE.charges] };
    }
    throw error;
  }
}

export async function listBillingProfiles(): Promise<BillingProfile[]> {
  const rows = await query<ProfileRow>(
    `SELECT id, branch_id, warehouse_id, name, is_active
     FROM pos.pos_billing_profiles
     WHERE is_active = true
     ORDER BY
       CASE WHEN branch_id IS NULL THEN 0 WHEN warehouse_id IS NULL THEN 1 ELSE 2 END,
       name ASC`
  );

  const profiles: BillingProfile[] = [];
  for (const row of rows) {
    const charges = await loadCharges(String(row.id));
    profiles.push(normalizeBillingProfile(row, charges));
  }
  return profiles;
}

export async function upsertBillingProfile(input: {
  id?: string | null;
  branchId: string | null;
  warehouseId: string | null;
  name: string;
  updatedBy: string;
  charges: Array<{
    code: string;
    name: string;
    charge_kind: string;
    calc_method: string;
    rate: number;
    amount: number;
    apply_order: number;
    is_enabled: boolean;
    is_optional: boolean;
    base: string;
  }>;
}): Promise<BillingProfile> {
  const name = input.name.trim() || "Billing Profile";
  const now = new Date().toISOString();

  let profileId = input.id?.trim() || null;

  if (profileId) {
    await query(
      `UPDATE pos.pos_billing_profiles
       SET name = $2,
           branch_id = $3,
           warehouse_id = $4,
           is_active = true,
           updated_by = $5,
           updated_at = $6::timestamptz
       WHERE id = $1`,
      [profileId, name, input.branchId, input.warehouseId, input.updatedBy, now]
    );
  } else {
    // Deactivate existing active profile on same scope, then insert.
    await query(
      `UPDATE pos.pos_billing_profiles
       SET is_active = false, updated_at = $3::timestamptz, updated_by = $4
       WHERE is_active = true
         AND COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
             = COALESCE($1::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
         AND COALESCE(warehouse_id, '00000000-0000-0000-0000-000000000000'::uuid)
             = COALESCE($2::uuid, '00000000-0000-0000-0000-000000000000'::uuid)`,
      [input.branchId, input.warehouseId, now, input.updatedBy]
    );

    const inserted = await queryOne<{ id: string }>(
      `INSERT INTO pos.pos_billing_profiles (
          branch_id, warehouse_id, name, is_active, updated_by, updated_at
        ) VALUES ($1, $2, $3, true, $4, $5::timestamptz)
        RETURNING id`,
      [input.branchId, input.warehouseId, name, input.updatedBy, now]
    );
    if (!inserted?.id) throw new Error("Failed to create billing profile");
    profileId = inserted.id;
  }

  await query(`DELETE FROM pos.pos_billing_charges WHERE profile_id = $1`, [profileId]);

  for (const charge of input.charges) {
    const code = String(charge.code || "").trim().toUpperCase();
    if (!code) continue;
    await query(
      `INSERT INTO pos.pos_billing_charges (
          profile_id, code, name, charge_kind, calc_method, rate, amount,
          apply_order, is_enabled, is_optional, base, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::timestamptz
        )`,
      [
        profileId,
        code,
        String(charge.name || code).trim(),
        charge.charge_kind,
        charge.calc_method,
        charge.rate,
        charge.amount,
        charge.apply_order,
        charge.is_enabled,
        charge.is_optional,
        charge.base,
        now,
      ]
    );
  }

  const profile = await loadProfileById(profileId);
  if (!profile) throw new Error("Billing profile not found after save");
  return profile;
}

export async function listBranchesForBilling() {
  return query<{ id: string; name: string; code: string }>(
    `SELECT id, name, code
     FROM configuration.branches
     WHERE is_active = true
     ORDER BY name ASC`
  );
}

export async function listWarehousesForBilling(branchId?: string | null) {
  if (branchId) {
    return query<{ id: string; name: string; code: string; branch_id: string }>(
      `SELECT id, name, code, branch_id
       FROM configuration.warehouses
       WHERE is_active = true AND branch_id = $1
       ORDER BY name ASC`,
      [branchId]
    );
  }
  return query<{ id: string; name: string; code: string; branch_id: string }>(
    `SELECT id, name, code, branch_id
     FROM configuration.warehouses
     WHERE is_active = true
     ORDER BY name ASC`
  );
}
