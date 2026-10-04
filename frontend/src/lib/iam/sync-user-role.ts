import { iamDbQuery, iamDbQueryOne, isIamDbConfigured } from "./pg-client";

/**
 * Sidebar memakai `iam.user_roles` dulu, baru fallback `configuration.users.role`.
 * Ganti role di Users wajib sync assignment IAM, kalau tidak menu lama (mis. employee) tetap menang.
 */
export async function syncIamPrimaryRole(
  userId: string,
  roleCode: string,
  assignedBy?: string | null
) {
  if (!isIamDbConfigured() || !userId || !roleCode) return;

  const role = await iamDbQueryOne<{ id: string }>(
    `SELECT id FROM iam.roles WHERE code = $1 AND deleted_at IS NULL LIMIT 1`,
    [roleCode]
  );

  await iamDbQuery(`DELETE FROM iam.user_roles WHERE user_id = $1`, [userId]);

  if (!role) return;

  await iamDbQuery(
    `INSERT INTO iam.user_roles (user_id, role_id, is_primary, assigned_by)
     VALUES ($1, $2, true, $3)`,
    [userId, role.id, assignedBy ?? null]
  );
}
