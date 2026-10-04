import { createServerPgClient } from "@/lib/pg/create-client";

/**
 * Aktor untuk route absensi/cuti: identitas akun login + record karyawan
 * yang tertaut. Kolom approved_by/validated_by ber-FK ke hris.employees(id),
 * jadi JANGAN pernah menulis userId ke sana — pakai employeeId (nullable
 * untuk akun non-karyawan seperti super_admin).
 */

export const HR_ROLES = ["super_admin", "admin", "hrd", "hiring_manager"] as const;

export interface WorkforceActor {
  userId: string;
  role: string;
  /** id hris.employees yang tertaut akun ini; null utk akun non-karyawan */
  employeeId: string | null;
  /** boleh melihat/mengelola data seluruh karyawan */
  isHr: boolean;
}

export async function getWorkforceActor(): Promise<WorkforceActor | null> {
  const db = await createServerPgClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return null;

  const [{ data: userData }, { data: employee }] = await Promise.all([
    db.from("users").select("role").eq("id", user.id).single(),
    db.from("employees").select("id").eq("user_id", user.id).single(),
  ]);

  const role: string = userData?.role ?? "";
  return {
    userId: user.id,
    role,
    employeeId: employee?.id ?? null,
    isHr: (HR_ROLES as readonly string[]).includes(role),
  };
}
