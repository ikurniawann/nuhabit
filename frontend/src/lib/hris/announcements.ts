/**
 * Konstanta & konfigurasi bersama modul Pengumuman Perusahaan.
 */

/** Role yang boleh mengelola pengumuman (CMS). Selaras menu iam + page guard. */
export const ANNOUNCEMENT_MANAGE_ROLES = [
  "super_admin",
  "admin",
  "hrd",
] as const;

export function canManageAnnouncements(role: string): boolean {
  return (ANNOUNCEMENT_MANAGE_ROLES as readonly string[]).includes(role);
}

/**
 * Allowlist DOMPurify untuk body_html pengumuman — dipakai SAMA di editor
 * (preview) maupun tampilan karyawan agar hasil konsisten & aman. Toolbar
 * Quill dibatasi ke set format ini.
 */
export const ANNOUNCEMENT_SANITIZE_CONFIG = {
  ALLOWED_TAGS: [
    "p", "br", "strong", "em", "u", "s", "blockquote",
    "h1", "h2", "h3", "ul", "ol", "li", "a", "span",
  ],
  ALLOWED_ATTR: ["href", "target", "rel", "class"],
  // Cegah skema berbahaya pada href
  ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|tel:|\/)/i,
} as const;

export const ANNOUNCEMENT_TAG_PRESETS = [
  "Kebijakan",
  "Acara",
  "Libur",
  "Kesehatan",
  "Keamanan",
  "Umum",
  "Penting",
];
