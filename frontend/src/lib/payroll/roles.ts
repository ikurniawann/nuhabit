/**
 * Akses lintas karyawan di daftar & pengajuan pinjaman (ESS tetap untuk
 * semua karyawan). Run payroll, pengaturan, dan persetujuan pinjaman
 * digerbang grant IAM hris.compensation di route, bukan daftar role ini.
 * Data pinjaman adalah PII finansial; jangan longgarkan tanpa review keamanan.
 */
export const LOAN_MANAGE_ROLES = [
  'super_admin',
  'admin',
  'hrd',
  'finance_staff',
] as const;
