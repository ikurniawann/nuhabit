/**
 * Pembatas alat Do per hak akses (IAM).
 *
 * Dulu Do hanya untuk super_admin karena alatnya membaca data karyawan,
 * absensi, stok, dan penjualan. Sekarang siapa pun boleh memakai Do, tapi
 * ALAT yang tersedia mengikuti menu yang memang boleh ia buka — kasir tidak
 * bisa menarik data karyawan hanya dengan meminta baik-baik ke asisten.
 */

export const TOOL_IAM_PREFIXES: Record<string, readonly string[]> = {
  cari_karyawan: ["hris.kepegawaian", "hris.workforce", "hris"],
  absensi_hari_ini: ["hris.workforce", "hris"],
  stok_menipis: ["items.raw-material", "items", "pos.catalog"],
  penjualan_periode: ["pos.reports", "pos"],
  status_kandidat: ["hris.recruitment"],
  usulkan_pengumuman_draft: ["hris"],
  usulkan_catatan_kandidat: ["hris.recruitment"],
};

/** Role yang memang memegang seluruh sistem — tidak perlu dipetakan per menu. */
export const FULL_ACCESS_ROLES = ["super_admin", "admin", "direksi"] as const;

export function hasIamPrefix(granted: readonly string[], prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) =>
    granted.some((code) => code === prefix || code.startsWith(`${prefix}.`))
  );
}

/**
 * Nama alat yang boleh dipakai. Role penuh dapat semuanya; sisanya menurut
 * menu. Tanpa data IAM sama sekali (instalasi baru) hanya role penuh yang
 * dapat alat — lebih aman salah ketat daripada salah longgar.
 */
export function allowedToolNames(
  role: string | null | undefined,
  grantedMenuCodes: readonly string[]
): string[] {
  const names = Object.keys(TOOL_IAM_PREFIXES);
  if (role && (FULL_ACCESS_ROLES as readonly string[]).includes(role)) return names;
  if (grantedMenuCodes.length === 0) return [];
  return names.filter((name) => hasIamPrefix(grantedMenuCodes, TOOL_IAM_PREFIXES[name] ?? []));
}

export function isToolAllowed(
  name: string,
  role: string | null | undefined,
  grantedMenuCodes: readonly string[]
): boolean {
  return allowedToolNames(role, grantedMenuCodes).includes(name);
}
