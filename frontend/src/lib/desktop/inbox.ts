/**
 * Kotak keputusan desktop — isi kartu "Perlu Keputusan", tapi berupa DAFTAR
 * yang bisa ditindaklanjuti, bukan sekadar angka. Cuti bisa disetujui
 * langsung dari widget; sisanya membuka halaman yang tepat sebagai jendela.
 */

export type InboxSectionKey = "cuti" | "po" | "stok";

export interface InboxItem {
  id: string;
  title: string;
  subtitle?: string | null;
  /** Halaman yang dibuka bila keputusan butuh konteks penuh. */
  href: string;
  /** true = ada tombol Setujui/Tolak langsung di widget. */
  actionable?: boolean;
}

export interface InboxSection {
  key: InboxSectionKey;
  label: string;
  total: number;
  items: InboxItem[];
}

export const INBOX_SECTION_IAM: Record<InboxSectionKey, readonly string[]> = {
  cuti: ["hris.workforce", "hris.kepegawaian", "hris"],
  po: ["items.product.approval", "items.raw-material.approval", "items.product.purchasing", "items.raw-material.purchasing"],
  stok: ["items.raw-material", "items", "pos.catalog"],
};

export const INBOX_SECTION_LABEL: Record<InboxSectionKey, string> = {
  cuti: "Pengajuan cuti",
  po: "PO menunggu approval",
  stok: "Stok di bawah minimum",
};

/** Maksimal item per seksi — widget desktop, bukan halaman laporan. */
export const INBOX_ITEM_LIMIT = 5;

export function allowedInboxSections(
  role: string | null | undefined,
  granted: readonly string[]
): InboxSectionKey[] {
  const keys = Object.keys(INBOX_SECTION_IAM) as InboxSectionKey[];
  if (role && ["super_admin", "admin", "direksi"].includes(role)) return keys;
  if (granted.length === 0) return [];
  return keys.filter((key) =>
    INBOX_SECTION_IAM[key].some((prefix) =>
      granted.some((code) => code === prefix || code.startsWith(`${prefix}.`))
    )
  );
}

export function totalInboxCount(sections: InboxSection[]): number {
  return sections.reduce((sum, section) => sum + section.total, 0);
}

/** Rentang tanggal cuti dalam bahasa manusia: "3 hari · 18–20 Sep". */
export function describeLeaveRange(start: string, end: string, days: number): string {
  const fmt = (iso: string) =>
    new Date(`${iso}T00:00:00`).toLocaleDateString("id-ID", { day: "numeric", month: "short" });
  const range = start === end ? fmt(start) : `${fmt(start)}–${fmt(end)}`;
  return `${days} hari · ${range}`;
}
