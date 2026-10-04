import "server-only";
/** Simpan & baca aturan gym untuk halaman admin. getGymRules ikut diekspor dari sini. */
import { getPool } from "@/lib/db";
import { GYM_RULE_DEFAULTS, resolveGymRules, sanitizeStoredRules, type GymRules } from "./rules";

export { getGymRules, GYM_RULE_DEFAULTS, type GymRules } from "./rules";

export interface GymRulesAdminView {
  defaults: GymRules;
  global: GymRules;
  branches: { id: string; name: string; override: Partial<GymRules> }[];
}

/** Aturan global efektif + daftar cabang aktif beserta override-nya. */
export async function loadGymRulesAdmin(): Promise<GymRulesAdminView> {
  const pool = getPool();
  const [rules, branches] = await Promise.all([
    pool.query<{ branch_id: string | null; rules: unknown }>(`SELECT branch_id, rules FROM gym.business_rules`),
    pool.query<{ id: string; name: string }>(
      `SELECT id, name FROM configuration.branches WHERE COALESCE(is_active, true) ORDER BY name`
    ),
  ]);
  const byBranch = new Map(rules.rows.map((r) => [r.branch_id, r.rules]));
  return {
    defaults: GYM_RULE_DEFAULTS,
    global: resolveGymRules(byBranch.get(null)),
    branches: branches.rows.map((b) => ({ id: b.id, name: b.name, override: sanitizeStoredRules(byBranch.get(b.id)) })),
  };
}

/**
 * Global: simpan aturan lengkap. Cabang: simpan override (kunci yang tidak
 * dikirim mengikuti global); override kosong menghapus baris cabang.
 */
export async function saveGymRules(branchId: string | null, rules: GymRules | Partial<GymRules>, actorId: string) {
  const pool = getPool();
  if (branchId && Object.keys(rules).length === 0) {
    await pool.query(`DELETE FROM gym.business_rules WHERE branch_id = $1`, [branchId]);
    return;
  }
  const params = [JSON.stringify(rules), actorId];
  if (branchId) {
    await pool.query(
      `INSERT INTO gym.business_rules (branch_id, rules, updated_by) VALUES ($3, $1::jsonb, $2)
       ON CONFLICT (branch_id) DO UPDATE SET rules = EXCLUDED.rules, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [...params, branchId]
    );
  } else {
    const { rowCount } = await pool.query(
      `UPDATE gym.business_rules SET rules = $1::jsonb, updated_by = $2, updated_at = now() WHERE branch_id IS NULL`,
      params
    );
    if (!rowCount) await pool.query(`INSERT INTO gym.business_rules (branch_id, rules, updated_by) VALUES (NULL, $1::jsonb, $2)`, params);
  }
}
