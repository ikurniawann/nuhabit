/**
 * Kebijakan akses area kerja.
 *
 * Role "full access" melihat desktop NüHabit OS + seluruh modul bisnis. Role
 * lain dikunci ke Area Karyawan (ESS/HRIS) di /dashboard/me: login langsung
 * ke sana, sidebar hanya menu karyawan, dan URL modul lain dilempar balik.
 *
 * Daftar full-access sengaja kecil & terpusat di sini agar mudah diperluas
 * ke depan tanpa menyentuh logika di banyak tempat.
 *
 * CATATAN: penentuan utama kini berbasis IAM (`isEssOnlyUser` di
 * get-user-menus.ts) — user full-access bila role IAM-nya punya permission
 * menu non-ESS. Daftar di bawah dipakai sebagai jalur cepat & fallback bila
 * IAM tidak tersedia / belum ter-seed.
 */

export const FULL_ACCESS_ROLES = ["super_admin", "admin", "hrd"] as const;

/** Role dengan akses penuh (desktop + semua modul). */
export function isFullAccessRole(role: string | null | undefined): boolean {
  return !!role && (FULL_ACCESS_ROLES as readonly string[]).includes(role);
}

/** Role yang dikunci hanya ke Area Karyawan (ESS). Kebalikan full-access. */
export function isEssOnlyRole(role: string | null | undefined): boolean {
  return !isFullAccessRole(role);
}

/** Beranda / akar Area Karyawan (ESS). */
export const ESS_HOME_PATH = "/dashboard/me";

/** True bila path berada di dalam Area Karyawan (ESS). */
export function isEssPath(pathname: string): boolean {
  return pathname === ESS_HOME_PATH || pathname.startsWith(`${ESS_HOME_PATH}/`);
}

/**
 * Modul tambahan untuk role non-full-access (EPIC-022): role di daftar ini
 * tetap ESS-only untuk modul lain, tapi boleh masuk prefix modulnya sendiri.
 * Sengaja BUKAN lewat FULL_ACCESS_ROLES agar tidak membuka seluruh dashboard.
 */
export const ROLE_MODULE_PATHS: Record<string, readonly string[]> = {
  sales: ["/dashboard/sales-funnel"],
  // EPIC-025: finance memproses invoice B2B + accounting
  finance_staff: ["/dashboard/accounting", "/dashboard/finance"],
  // EPIC-032: marketing mengelola campaign promo, kode & voucher
  marketing: ["/dashboard/promo"],
};

/** Prefix modul tambahan yang boleh diakses sebuah role (di luar ESS). */
export function allowedModulePaths(
  role: string | null | undefined
): readonly string[] {
  return role ? ROLE_MODULE_PATHS[role] ?? [] : [];
}

/** True bila role boleh membuka pathname (full access, ESS, atau modulnya). */
export function canAccessPath(
  role: string | null | undefined,
  pathname: string
): boolean {
  if (isFullAccessRole(role)) return true;
  if (isEssPath(pathname)) return true;
  return allowedModulePaths(role).some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

function hrefCoversPath(href: string, pathname: string): boolean {
  if (href === "/dashboard") return pathname === "/dashboard";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Halaman cetak PR/PO hidup di `/dashboard/purchasing/print/{pr|po}/:id`
 * (bukan child dari menu PR/PO). Tanpa alias ini layout me-redirect ke
 * Beranda karena prefix match gagal.
 */
const PRINT_DOCUMENT_OWNERS: ReadonlyArray<{
  pathPattern: RegExp;
  menuSuffixes: readonly string[];
}> = [
  { pathPattern: /\/print\/pr(?:\/|$)/, menuSuffixes: ["/purchasing/pr", "/approval/pr"] },
  { pathPattern: /\/print\/po(?:\/|$)/, menuSuffixes: ["/purchasing/po", "/approval/po"] },
];

function menuOwnsPrintPath(pathname: string, menuHrefs: readonly string[]): boolean {
  const owners = PRINT_DOCUMENT_OWNERS.find((row) => row.pathPattern.test(pathname));
  if (!owners) return false;
  return menuHrefs.some((href) =>
    owners.menuSuffixes.some(
      (suffix) => href === suffix || href.endsWith(suffix) || href.includes(`${suffix}/`)
    )
  );
}

/**
 * True bila pathname tercakup salah satu href menu IAM yang di-grant ke
 * user (prefix match). Root "/dashboard" sengaja EXACT-only — banyak role
 * punya menu Beranda, dan prefix "/dashboard" akan meloloskan semua modul
 * (fix H1 security review EPIC-032 A4).
 */
export function isPathAllowedByMenus(
  pathname: string,
  menuHrefs: readonly string[]
): boolean {
  if (menuHrefs.some((href) => hrefCoversPath(href, pathname))) return true;
  return menuOwnsPrintPath(pathname, menuHrefs);
}
