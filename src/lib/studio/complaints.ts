/**
 * Tiket keluhan pelanggan (EPIC-067 T-067-B1). Logika murni — query di
 * complaints-server.ts. Batas waktu per kategori mengikuti keputusan client
 * no. 7 (cedera 2 jam respons / 24 jam selesai; lainnya 24 jam / 3 hari);
 * pengaturannya menyusul di T-067-B2.
 */

import type { CsCategory, CsPriority } from "@/lib/crm/cs-rules";

export const COMPLAINT_CATEGORIES = ["coach", "class", "facility", "injury", "billing", "other"] as const;
export type ComplaintCategory = (typeof COMPLAINT_CATEGORIES)[number];

export const COMPLAINT_CATEGORY_LABEL: Record<ComplaintCategory, string> = {
  coach: "Coach",
  class: "Kelas",
  facility: "Fasilitas",
  injury: "Cedera",
  billing: "Billing",
  other: "Lainnya",
};

export const COMPLAINT_SOURCES = ["wa", "front_desk", "member_app"] as const;
export type ComplaintSource = (typeof COMPLAINT_SOURCES)[number];

export const COMPLAINT_SOURCE_LABEL: Record<ComplaintSource, string> = {
  wa: "WhatsApp",
  front_desk: "Front desk",
  member_app: "Member App",
};

export const COMPLAINT_STATUSES = ["received", "in_progress", "resolved", "confirmed", "cancelled"] as const;
export type ComplaintStatus = (typeof COMPLAINT_STATUSES)[number];

export const COMPLAINT_STATUS_LABEL: Record<ComplaintStatus, string> = {
  received: "Diterima",
  in_progress: "Ditangani",
  resolved: "Selesai",
  confirmed: "Dikonfirmasi member",
  cancelled: "Dibatalkan",
};

export type ComplaintPriority = CsPriority;

/** Masih perlu ditangani (belum selesai / dibatalkan). */
export function isComplaintOpen(status: ComplaintStatus): boolean {
  return status === "received" || status === "in_progress";
}

export interface ComplaintSla {
  respond_hours: number;
  resolve_hours: number;
}

export type ComplaintSlaRules = Record<ComplaintCategory, ComplaintSla>;

export const DEFAULT_COMPLAINT_SLA: ComplaintSlaRules = {
  injury: { respond_hours: 2, resolve_hours: 24 },
  coach: { respond_hours: 24, resolve_hours: 72 },
  class: { respond_hours: 24, resolve_hours: 72 },
  facility: { respond_hours: 24, resolve_hours: 72 },
  billing: { respond_hours: 24, resolve_hours: 72 },
  other: { respond_hours: 24, resolve_hours: 72 },
};

export function complaintDeadlines(
  category: ComplaintCategory,
  createdAt: Date,
  rules: ComplaintSlaRules = DEFAULT_COMPLAINT_SLA
): { respondBy: Date; resolveBy: Date } {
  const sla = rules[category];
  return {
    respondBy: new Date(createdAt.getTime() + sla.respond_hours * 3_600_000),
    resolveBy: new Date(createdAt.getTime() + sla.resolve_hours * 3_600_000),
  };
}

/** Prioritas awal bila staf tidak memilih: cedera selalu tinggi. */
export function defaultComplaintPriority(category: ComplaintCategory): ComplaintPriority {
  return category === "injury" ? "high" : "normal";
}

/** Kategori WA inbox (EPIC-012) → kategori tiket. Yang tidak jelas jatuh ke "Lainnya" untuk dipilah staf. */
export function categoryFromCs(cs: CsCategory | null | undefined): ComplaintCategory {
  return cs === "pembayaran" ? "billing" : "other";
}

/** "KEL-2610-0007" — kode per bulan (WIB). */
export function complaintCode(now: Date, seq: number): string {
  const wib = new Date(now.getTime() + 7 * 3_600_000);
  const yymm = `${String(wib.getUTCFullYear()).slice(2)}${String(wib.getUTCMonth() + 1).padStart(2, "0")}`;
  return `KEL-${yymm}-${String(seq).padStart(4, "0")}`;
}

/** Judul otomatis dari deskripsi bila staf tidak mengisi judul. */
export function complaintTitle(title: string | null | undefined, description: string | null | undefined, category: ComplaintCategory): string {
  const t = (title ?? "").trim();
  if (t) return t.slice(0, 120);
  const d = (description ?? "").trim().replace(/\s+/g, " ");
  if (d) return d.length > 80 ? `${d.slice(0, 77)}…` : d;
  return `Keluhan ${COMPLAINT_CATEGORY_LABEL[category].toLowerCase()}`;
}
