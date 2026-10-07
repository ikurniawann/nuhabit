/**
 * Ulasan member atas order lunas (murni, tanpa DB): kelayakan memberi
 * ulasan dan ringkasan rating untuk halaman admin.
 */

/** Ulasan dibuka maksimal 14 hari setelah order lunas. */
export const REVIEW_WINDOW_DAYS = 14;
const REVIEW_WINDOW_MS = REVIEW_WINDOW_DAYS * 24 * 60 * 60 * 1000;

export const REVIEW_COMMENT_MAX = 1000;
export const REVIEW_REPLY_MAX = 1000;

export type ReviewIneligibleReason =
  | "order-tidak-ditemukan"
  | "bukan-order-member"
  | "belum-lunas"
  | "order-batal"
  | "lewat-batas-waktu"
  | "sudah-diulas";

export const REVIEW_INELIGIBLE_MESSAGES: Record<ReviewIneligibleReason, string> = {
  "order-tidak-ditemukan": "Order tidak ditemukan",
  "bukan-order-member": "Order ini bukan milik akun Anda",
  "belum-lunas": "Order belum lunas",
  "order-batal": "Order dibatalkan",
  "lewat-batas-waktu": `Ulasan hanya bisa diberikan maksimal ${REVIEW_WINDOW_DAYS} hari setelah order`,
  "sudah-diulas": "Order ini sudah Anda ulas",
};

export interface ReviewableOrder {
  customer_id: string | null;
  payment_status: string;
  status: string;
  /** Waktu order selesai/lunas (completed_at, jatuh ke ordered_at). */
  paid_at: string | Date;
}

const CLOSED_ORDER_STATUSES = new Set(["cancelled", "voided", "merged"]);

/** Satu ulasan per order, untuk order lunas milik member, dalam 14 hari. */
export function reviewEligibility(
  order: ReviewableOrder | null,
  ctx: { customerId: string; now: Date; alreadyReviewed: boolean }
): { ok: true } | { ok: false; reason: ReviewIneligibleReason } {
  if (!order) return { ok: false, reason: "order-tidak-ditemukan" };
  if (order.customer_id !== ctx.customerId) return { ok: false, reason: "bukan-order-member" };
  if (CLOSED_ORDER_STATUSES.has(order.status)) return { ok: false, reason: "order-batal" };
  if (order.payment_status !== "paid") return { ok: false, reason: "belum-lunas" };
  if (ctx.alreadyReviewed) return { ok: false, reason: "sudah-diulas" };
  if (ctx.now.getTime() - new Date(order.paid_at).getTime() > REVIEW_WINDOW_MS) {
    return { ok: false, reason: "lewat-batas-waktu" };
  }
  return { ok: true };
}

/** Komentar/balasan: dipangkas, kosong jadi null, dipotong di batas. */
export function cleanReviewText(text: string | null | undefined, max = REVIEW_COMMENT_MAX): string | null {
  const value = (text ?? "").trim();
  return value ? value.slice(0, max) : null;
}

export interface RatingCountRow {
  branch_id: string | null;
  branch_name: string | null;
  rating: number;
  n: number;
}

export interface ReviewSummary {
  count: number;
  average: number | null;
  /** Jumlah ulasan per bintang, indeks 0 = bintang 1. */
  distribution: [number, number, number, number, number];
  outlets: Array<{ branch_id: string | null; name: string; count: number; average: number }>;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Ringkasan dari hitungan (outlet × bintang): rata-rata, sebaran, per outlet. */
export function summarizeReviews(rows: RatingCountRow[]): ReviewSummary {
  const distribution: ReviewSummary["distribution"] = [0, 0, 0, 0, 0];
  const outlets = new Map<string, { branch_id: string | null; name: string; count: number; total: number }>();
  let count = 0;
  let total = 0;
  for (const row of rows) {
    const rating = Math.round(Number(row.rating));
    const n = Number(row.n) || 0;
    if (rating < 1 || rating > 5 || n <= 0) continue;
    distribution[rating - 1] += n;
    count += n;
    total += rating * n;
    const key = row.branch_id ?? "";
    const outlet = outlets.get(key) ?? {
      branch_id: row.branch_id,
      name: row.branch_name ?? "Tanpa outlet",
      count: 0,
      total: 0,
    };
    outlet.count += n;
    outlet.total += rating * n;
    outlets.set(key, outlet);
  }
  return {
    count,
    average: count > 0 ? round1(total / count) : null,
    distribution,
    outlets: [...outlets.values()]
      .map((o) => ({ branch_id: o.branch_id, name: o.name, count: o.count, average: round1(o.total / o.count) }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "id")),
  };
}
