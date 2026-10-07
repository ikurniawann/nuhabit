/**
 * Aturan tampilan halaman onboarding karyawan.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export const EMPLOYMENT_STATUS_BADGES: Record<string, { label: string; className: string }> = {
  probation: { label: "Probation", className: "bg-yellow-100 text-yellow-800" },
  contract: { label: "Kontrak", className: "bg-blue-100 text-blue-800" },
  permanent: { label: "Tetap", className: "bg-green-100 text-green-800" },
  internship: { label: "Magang", className: "bg-purple-100 text-purple-800" },
};

/** Masa kerja dalam hari penuh sejak tanggal bergabung. */
export function tenureDays(joinDate: string, now: Date): number {
  return Math.floor((now.getTime() - new Date(joinDate).getTime()) / DAY_MS);
}
