/**
 * Peran lama untuk route onboarding, offboarding, dan saldo cuti per
 * karyawan: "HRD" = role hrd, "manajer" = hiring_manager atau hrd.
 * Data peran diambil dari aktor workforce (users.role).
 */

export const isHrdRole = (role: string): boolean => role === "hrd";

export const isLineManagerRole = (role: string): boolean =>
  role === "hiring_manager" || role === "hrd";
