/**
 * Role yang berhak mengelola payroll (run, kalkulasi, pengaturan, slip HR).
 * Data gaji adalah PII finansial — jangan longgarkan tanpa review keamanan.
 */

export const PAYROLL_MANAGE_ROLES = [
  'super_admin',
  'hrd',
  'finance_staff',
] as const;

/**
 * Menghapus payroll run (Run Penggajian) hanya Super Admin — permintaan client
 * 2026-10-22: role lain tetap boleh membuat, menghitung, dan memproses run.
 */
export const PAYROLL_DELETE_ROLES = ['super_admin'] as const;

export function canDeletePayrollRun(role: string | null | undefined): boolean {
  return (PAYROLL_DELETE_ROLES as readonly string[]).includes(role ?? '');
}

/** Pengubahan tarif statutori (BPJS/PPh21) dibatasi lebih ketat. */
export const PAYROLL_SETTINGS_WRITE_ROLES = ['super_admin', 'hrd'] as const;

/**
 * Kelola pinjaman karyawan — termasuk 'admin' (selaras menu
 * hris.compensation.loans & page guard); run payroll tetap 3 role di atas.
 */
export const LOAN_MANAGE_ROLES = [
  'super_admin',
  'admin',
  'hrd',
  'finance_staff',
] as const;
