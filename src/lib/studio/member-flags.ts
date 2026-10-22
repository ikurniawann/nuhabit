/**
 * Penanda member perhatian khusus (EPIC-067 T-067-C1/C2). Logika murni —
 * query & aturan akses di member-flags-server.ts.
 *
 * Aturan akses (keputusan client no. 9): penanda *medis* hanya boleh dilihat
 * detailnya oleh coach yang memegang sesi hari ini/mendatang dengan member itu
 * dan oleh coach pembuatnya. Backoffice hanya menerima jumlahnya.
 */

export type FlagCategory = "general" | "medical";
export type FlagSeverity = "info" | "attention" | "critical";

export const FLAG_SEVERITIES = ["info", "attention", "critical"] as const satisfies readonly FlagSeverity[];

export const SEVERITY_LABEL: Record<FlagSeverity, string> = {
  info: "Info",
  attention: "Perhatian",
  critical: "Kritis",
};

export const FLAG_NOTE_MAX = 200;

export interface FlagType {
  id: string;
  code: string;
  label: string;
  category: FlagCategory;
  sort_order: number;
  is_system: boolean;
  is_active: boolean;
}

/** Penanda lengkap — hanya boleh keluar ke pihak yang berhak melihatnya. */
export interface MemberFlag {
  id: string;
  customer_id: string;
  type_id: string;
  type_label: string;
  category: FlagCategory;
  severity: FlagSeverity;
  note: string | null;
  valid_until: string | null;
  created_by_coach_id: string | null;
  created_by_name: string | null;
  created_at: string;
  /** 'staff' | 'coach' | 'parq' (isian PAR-Q member, T-067-C3). */
  source: "staff" | "coach" | "parq";
  /** Penanda dari PAR-Q yang belum ditinjau coach. */
  needs_review: boolean;
}

/** Aktif = belum dihapus dan belum lewat masa berlaku (tanggal WIB). */
export function isFlagActive(f: { valid_until: string | null; removed_at?: string | null }, today: string): boolean {
  if (f.removed_at) return false;
  return !f.valid_until || f.valid_until >= today;
}

const SEVERITY_RANK: Record<FlagSeverity, number> = { critical: 0, attention: 1, info: 2 };

/** Urutan tampil: kritis dulu, medis sebelum umum, lalu terbaru. */
export function sortFlags<T extends Pick<MemberFlag, "severity" | "category" | "created_at">>(flags: T[]): T[] {
  return [...flags].sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      Number(b.category === "medical") - Number(a.category === "medical") ||
      b.created_at.localeCompare(a.created_at)
  );
}

/** Ringkasan untuk backoffice: penanda umum utuh, penanda medis hanya dihitung. */
export interface BackofficeFlagView<T> {
  general: T[];
  medical_count: number;
}

export function redactForBackoffice<T extends Pick<MemberFlag, "category">>(flags: T[]): BackofficeFlagView<T> {
  return {
    general: flags.filter((f) => f.category === "general"),
    medical_count: flags.filter((f) => f.category === "medical").length,
  };
}

/**
 * Bolehkah coach melihat detail penanda medis seorang member:
 * memegang sesi (tidak batal) hari ini/mendatang yang dibooking member itu,
 * atau dia sendiri yang membuat penanda tersebut.
 */
export function coachCanSeeMedical(input: { holdsCurrentSession: boolean; createdByMe: boolean }): boolean {
  return input.holdsCurrentSession || input.createdByMe;
}

/** Backoffice tidak boleh membuat / menghapus penanda medis — itu wewenang coach. */
export function backofficeCanManage(category: FlagCategory): boolean {
  return category === "general";
}

export function flagTypeCode(label: string): string {
  return (
    label
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 32) || "flag"
  );
}
