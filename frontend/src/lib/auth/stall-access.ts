import { query, queryOne } from "@/lib/db";
import { sortWarehouses } from "@/lib/configuration/sort-warehouses";
import { computeStallAllAccess } from "@/lib/users/stall-assignment";

export interface StallOption {
  id: string;
  name: string;
  code: string;
  is_default: boolean;
}

export interface StallAccess {
  /** true = boleh switch ke stall mana pun (termasuk "Semua Stall"). */
  allAccess: boolean;
  /** Stall yang boleh dipilih di switcher (sudah difilter & terurut). */
  stalls: StallOption[];
}

/**
 * Aturan switcher stall:
 * - super_admin / can_switch_stall / Main Storage: semua stall di branch.
 * - Selain itu: hanya stall penempatan (default).
 */
export async function getStallAccess(
  userId: string,
  role: string | null,
  branchId: string | null
): Promise<StallAccess> {
  const [assignments, flags] = await Promise.all([
    query<StallOption>(
      `SELECT w.id, w.name, w.code, w.is_default
       FROM configuration.user_warehouses uw
       JOIN configuration.warehouses w ON w.id = uw.warehouse_id AND w.is_active
       WHERE uw.user_id = $1 AND uw.is_active`,
      [userId]
    ),
    queryOne<{ can_switch_stall: boolean }>(
      `SELECT COALESCE(can_switch_stall, false) AS can_switch_stall
       FROM configuration.users
       WHERE id = $1`,
      [userId]
    ),
  ]);

  const allAccess = computeStallAllAccess({
    role,
    canSwitchStall: flags?.can_switch_stall === true,
    assignedMainStorage: assignments.some((assignment) => assignment.is_default),
  });

  if (!allAccess) {
    return { allAccess, stalls: sortWarehouses(assignments) };
  }

  const params: unknown[] = [];
  let where = "w.is_active";
  if (branchId) {
    params.push(branchId);
    where += ` AND w.branch_id = $${params.length}`;
  }

  const stalls = await query<StallOption>(
    `SELECT w.id, w.name, w.code, w.is_default
     FROM configuration.warehouses w
     WHERE ${where}`,
    params
  );

  return { allAccess, stalls: sortWarehouses(stalls) };
}
