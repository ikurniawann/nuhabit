import { ApiError, requireApiUser } from "@/lib/api/auth";
import { queryOne } from "@/lib/db";
import { hasAnyIamMenuPrefix, loadGrantedMenuCodesForUser } from "@/lib/iam/has-menu";
import { IAM } from "@/lib/iam/prefixes";

/**
 * Gerbang data karyawan per record. IAM.hris saja terlalu longgar: role
 * `employee` (ESS) juga punya grant hris.performance.*, jadi prefix "hris"
 * meloloskan semua karyawan. Konstanta di bawah memilih sub-menu yang
 * memang mengelola data karyawan.
 */

/** Pengelola record lengkap (termasuk rekening, NPWP, KTP). */
export const EMPLOYEE_RECORD_MANAGERS = [
  ...IAM.hrisKepegawaian,
  ...IAM.settingsUsers,
] as const;

/**
 * Pembaca direktori karyawan (nama, NIP, departemen, jabatan; tanpa data
 * pribadi): halaman HRIS yang memilih karyawan, Settings → Users, dan
 * ticketing (pairing pass staf).
 */
export const EMPLOYEE_DIRECTORY_READERS = [
  ...EMPLOYEE_RECORD_MANAGERS,
  ...IAM.hrisWorkforce,
  ...IAM.hrisCompensation,
  ...IAM.hrisOrganization,
  ...IAM.ticketing,
] as const;

export type EmployeeAccess = "manager" | "self";

/** Keputusan murni: pengelola boleh semua record, karyawan hanya miliknya. */
export function decideEmployeeAccess(input: {
  grantedCodes: readonly string[];
  managerPrefixes: readonly string[];
  actorEmployeeId: string | null;
  targetEmployeeId: string;
}): EmployeeAccess | null {
  if (hasAnyIamMenuPrefix(input.grantedCodes, input.managerPrefixes)) return "manager";
  if (input.actorEmployeeId && input.actorEmployeeId === input.targetEmployeeId) return "self";
  return null;
}

/**
 * Wajib sesi; lolos bila user punya salah satu `managerPrefixes` atau
 * `targetEmployeeId` adalah record karyawan miliknya sendiri (ESS).
 * Melempar ApiError 401/403.
 */
export async function requireEmployeeAccess(
  targetEmployeeId: string,
  managerPrefixes: readonly string[] = EMPLOYEE_RECORD_MANAGERS
): Promise<EmployeeAccess> {
  const user = await requireApiUser();
  const grantedCodes = await loadGrantedMenuCodesForUser(user.id, user.role);
  // Record milik sendiri hanya dicari bila user bukan pengelola
  const own = hasAnyIamMenuPrefix(grantedCodes, managerPrefixes)
    ? null
    : await queryOne<{ id: string }>(
        "SELECT id FROM hris.employees WHERE user_id = $1 LIMIT 1",
        [user.id]
      );
  const access = decideEmployeeAccess({
    grantedCodes,
    managerPrefixes,
    actorEmployeeId: own?.id ?? null,
    targetEmployeeId,
  });
  if (!access) throw ApiError.forbidden("Insufficient permissions");
  return access;
}
