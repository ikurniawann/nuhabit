/**
 * EPIC-020 Fase B — formatter pesan & kunci dedup notifikasi WA owner.
 * Murni tanpa I/O supaya bisa diuji: pengiriman & pembacaan config ada di
 * notifications-sender.ts.
 */

import type { DesktopOverview } from "@/lib/desktop/overview";

const formatRp = (n: number) => `Rp${Math.round(n).toLocaleString("id-ID")}`;

/** Tanggal operasional WIB (yyyy-mm-dd) — tanggal server belum tentu sama. */
export function todayWib(now = new Date()): string {
  return new Date(now.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** Jam WIB 0-23 saat ini — penentu jadwal digest. */
export function hourWib(now = new Date()): number {
  return new Date(now.getTime() + 7 * 60 * 60 * 1000).getUTCHours();
}

/** Nomor minggu ISO (WIB) — kunci dedup mingguan omzet anjlok. */
export function isoWeekWib(now = new Date()): string {
  const wib = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  const d = new Date(Date.UTC(wib.getUTCFullYear(), wib.getUTCMonth(), wib.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((d.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

// ---------- Kunci dedup (unik per kejadian, lihat uq_wa_notif_log_dedup) ----

export const digestDedupKey = (dateWib: string) => dateWib;
export const voidDedupKey = (orderId: string) => orderId;
export const stokHabisDedupKey = (rawMaterialId: string, dateWib: string) =>
  `${rawMaterialId}:${dateWib}`;
export const komplainDedupKey = (conversationId: string) => conversationId;
export const reviewRendahDedupKey = (reviewId: string) => reviewId;
/** Maks 1×/minggu selama masih anjlok — tidak diberondong sebulan penuh. */
export const omzetAnjlokDedupKey = (isoWeek: string) => isoWeek;
export const approvalMenginapDedupKey = (dateWib: string) => dateWib;
/** Ganti kontrak (end_date baru) = kejadian baru. */
/** Satu pesan per PR per status (draft & diajukan) — edit draft berulang tidak spam. */
export const prMendesakDedupKey = (prId: string, status: string) => `${prId}:${status}`;
export const kontrakHabisDedupKey = (contractId: string, endDate: string) =>
  `${contractId}:${endDate}`;

// ---------- Pesan ----------

export function buildVoidBesarMessage(input: {
  orderNumber: string;
  total: number;
  reason: string;
  supervisorName: string;
}): string {
  return [
    `🚨 *Void Bernilai Besar*`,
    ``,
    `Order ${input.orderNumber} senilai *${formatRp(input.total)}* di-void.`,
    `Alasan: ${input.reason.slice(0, 200)}`,
    `Disetujui: ${input.supervisorName}`,
    ``,
    `Cek POS → Laporan untuk rinciannya.`,
  ].join("\n");
}

export interface PrMendesakInput {
  prNumber: string;
  /** 'draft' = baru dibuat, 'pending_head' = diajukan minta persetujuan. */
  status: string;
  requesterName: string;
  departmentName?: string | null;
  totalAmount: number;
  requiredDate?: string | null;
  notes?: string | null;
  items: { description: string; qty: number; unit?: string | null }[];
}

export function buildPrMendesakMessage(input: PrMendesakInput): string {
  const submitted = input.status !== "draft";
  const top = input.items.slice(0, 5).map(
    (it) => `• ${it.description.slice(0, 60)} — ${it.qty.toLocaleString("id-ID")} ${it.unit ?? ""}`.trimEnd()
  );
  const more = input.items.length > 5 ? [`• …dan ${input.items.length - 5} item lain`] : [];
  return [
    `🔴 *Purchase Request MENDESAK*`,
    ``,
    `${input.prNumber} ${submitted ? "diajukan, menunggu persetujuan" : "dibuat (draft)"}.`,
    `Pemohon: ${input.requesterName}${input.departmentName ? ` · ${input.departmentName}` : ""}`,
    `Total estimasi: *${formatRp(input.totalAmount)}*`,
    `Dibutuhkan: ${input.requiredDate ?? "-"}`,
    ...(input.notes ? [`Catatan: ${input.notes.slice(0, 200)}`] : []),
    ``,
    ...top,
    ...more,
    ``,
    `Buka Purchasing → Purchase Request untuk ${submitted ? "menyetujui" : "meninjau"}.`,
  ].join("\n");
}

export interface StokHabisItem {
  nama: string;
  satuan: string | null;
}

export function buildStokHabisMessage(items: StokHabisItem[]): string {
  const daftar = items
    .map((i) => `• ${i.nama}${i.satuan ? ` (${i.satuan})` : ""}`)
    .join("\n");
  return [
    `🚨 *Stok Bahan HABIS*`,
    ``,
    `${items.length} bahan mencapai NOL — menu terkait bisa berhenti terjual:`,
    daftar,
    ``,
    `Segera restock atau nonaktifkan menu terdampak.`,
  ].join("\n");
}

export function buildKomplainMessage(input: {
  displayName: string | null;
  phone: string;
  category: string | null;
  priority: string | null;
}): string {
  return [
    `🚨 *Komplain Pelanggan Masuk*`,
    ``,
    `Dari: ${input.displayName || input.phone}`,
    input.category ? `Kategori: ${input.category}` : null,
    input.priority ? `Prioritas: ${input.priority}` : null,
    ``,
    `Buka CRM → Inbox WA untuk menangani.`,
  ]
    .filter((l): l is string => l !== null)
    .join("\n");
}

export function buildReviewRendahMessage(input: {
  reviewerName: string | null;
  starRating: number;
  comment: string | null;
}): string {
  const bintang = "⭐".repeat(Math.max(1, Math.min(5, input.starRating)));
  return [
    `🚨 *Review Google Bintang Rendah*`,
    ``,
    `${bintang} (${input.starRating}/5) dari ${input.reviewerName || "Anonim"}`,
    input.comment ? `"${input.comment.slice(0, 300)}"` : null,
    ``,
    `Balas segera di CRM → Google Review — respons cepat menyelamatkan reputasi.`,
  ]
    .filter((l): l is string => l !== null)
    .join("\n");
}

/**
 * Omzet MTD anjlok (keputusan owner 2026-07-22): bandingkan omzet tanggal
 * 1..kemarin dengan pace target bulanan (bila diisi) atau MTD bulan lalu.
 */
export function buildOmzetAnjlokMessage(input: {
  mtd: number;
  baseline: number;
  /** Persen MTD terhadap baseline (sudah dibulatkan). */
  pct: number;
  source: "target" | "bulan-lalu";
  /** Jumlah hari penuh yang dihitung (tanggal 1..kemarin). */
  hariBerjalan: number;
}): string {
  const pembanding =
    input.source === "target"
      ? `pace target bulanan (${formatRp(input.baseline)} s/d hari ke-${input.hariBerjalan})`
      : `omzet bulan lalu di titik yang sama (${formatRp(input.baseline)})`;
  return [
    `⚠️ *Omzet Bulan Ini Anjlok*`,
    ``,
    `Omzet berjalan (tgl 1–${input.hariBerjalan}): *${formatRp(input.mtd)}*`,
    `Baru *${input.pct}%* dari ${pembanding}.`,
    ``,
    `Cek /dashboard untuk rincian per outlet & harian.`,
  ].join("\n");
}

export function buildApprovalMenginapMessage(input: {
  cuti: number;
  lembur: number;
  pinjaman: number;
  poDraft: number;
}): string {
  const total = input.cuti + input.lembur + input.pinjaman + input.poDraft;
  const rincian = [
    input.cuti > 0 ? `• ${input.cuti} pengajuan cuti` : null,
    input.lembur > 0 ? `• ${input.lembur} pengajuan lembur` : null,
    input.pinjaman > 0 ? `• ${input.pinjaman} pengajuan pinjaman` : null,
    input.poDraft > 0 ? `• ${input.poDraft} PO draft` : null,
  ]
    .filter((l): l is string => l !== null)
    .join("\n");
  return [
    `⚠️ *Approval Menginap*`,
    ``,
    `${total} pengajuan menunggu keputusan lebih dari 2 hari:`,
    rincian,
    ``,
    `Tim menunggu — buka dashboard untuk memutuskan.`,
  ].join("\n");
}

export interface KontrakHabisItem {
  employeeName: string;
  endDate: string;
  daysLeft: number;
}

export function buildKontrakHabisMessage(items: KontrakHabisItem[]): string {
  const daftar = items
    .map((i) => {
      const tgl = new Date(`${i.endDate}T00:00:00+07:00`).toLocaleDateString(
        "id-ID",
        { day: "numeric", month: "short", timeZone: "Asia/Jakarta" }
      );
      const sisa = i.daysLeft <= 0 ? "SUDAH LEWAT" : `${i.daysLeft} hari lagi`;
      return `• ${i.employeeName} — ${tgl} (${sisa})`;
    })
    .join("\n");
  return [
    `⚠️ *Kontrak PKWT Mendekati Habis*`,
    ``,
    `${items.length} kontrak berakhir ≤ 30 hari:`,
    daftar,
    ``,
    `Putuskan perpanjang/akhiri di HRIS → Kontrak sebelum jatuh tempo.`,
  ].join("\n");
}

/**
 * Ringkasan harian jam tutup — satu pesan padat dari data papan desktop.
 * Seksi yang gagal dimuat dilewati (bukan angka nol palsu).
 */
export function buildDigestMessage(
  overview: DesktopOverview,
  dateWib: string
): string {
  const tanggal = new Date(`${dateWib}T00:00:00+07:00`).toLocaleDateString(
    "id-ID",
    // timeZone wajib — server UTC membaca 00:00 WIB sebagai tanggal kemarin.
    { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Jakarta" }
  );
  const lines: (string | null)[] = [`📊 *Ringkasan Harian — ${tanggal}*`, ``];

  if (overview.pulsaBisnis) {
    const { hariIni, kemarin } = overview.pulsaBisnis;
    const delta =
      kemarin.omzet > 0
        ? Math.round(((hariIni.omzet - kemarin.omzet) / kemarin.omzet) * 100)
        : null;
    const arah =
      delta === null ? "" : delta >= 0 ? ` (▲ ${delta}% vs kemarin)` : ` (▼ ${Math.abs(delta)}% vs kemarin)`;
    lines.push(
      `*Omzet:* ${formatRp(hariIni.omzet)} dari ${hariIni.pesanan} pesanan${arah}`
    );
  }

  if (overview.timHariIni) {
    const t = overview.timHariIni;
    lines.push(
      `*Tim:* ${t.hadir}/${t.aktif} hadir` +
        (t.terlambat > 0 ? `, ${t.terlambat} terlambat` : "") +
        (t.cuti > 0 ? `, ${t.cuti} cuti` : "") +
        (t.belum > 0 ? `, ${t.belum} belum absen` : "")
    );
  }

  if (overview.perluKeputusan && overview.perluKeputusan.total > 0) {
    const p = overview.perluKeputusan;
    const rincian = [
      p.cuti > 0 ? `${p.cuti} cuti` : null,
      p.lembur > 0 ? `${p.lembur} lembur` : null,
      p.pinjaman > 0 ? `${p.pinjaman} pinjaman` : null,
      p.poDraft > 0 ? `${p.poDraft} PO draft` : null,
      p.kandidatBaru > 0 ? `${p.kandidatBaru} kandidat baru` : null,
    ]
      .filter((s) => s !== null)
      .join(", ");
    lines.push(`*Menunggu keputusan:* ${p.total} (${rincian})`);
  }

  if (overview.stokMenipis && overview.stokMenipis.jumlah > 0) {
    const teratas = overview.stokMenipis.teratas
      .map((i) => i.bahan)
      .join(", ");
    lines.push(
      `*Stok menipis:* ${overview.stokMenipis.jumlah} bahan (${teratas})`
    );
  }

  if (lines.length === 2) {
    lines.push("Belum ada data hari ini.");
  }
  lines.push(``, `Buka desktop BCD Coffee OS untuk rinciannya.`);
  return lines.filter((l): l is string => l !== null).join("\n");
}
