import { ApiError, type ApiUser } from "@/lib/api/auth";

/**
 * Tarif statutori (BPJS/PPh21) dan konfigurasi pajak hanya boleh diubah
 * super_admin dan HRD, di atas grant menu hris.compensation. Pembacaan
 * cukup grant menu.
 */
export const PAYROLL_SETTINGS_WRITE_ROLES: readonly string[] = ["super_admin", "hrd"];

export function assertPayrollSettingsWriter(user: Pick<ApiUser, "role">): void {
  if (!PAYROLL_SETTINGS_WRITE_ROLES.includes(user.role)) {
    throw ApiError.forbidden("Hanya super admin dan HRD yang boleh mengubah pengaturan payroll");
  }
}
