/**
 * Dokumen SOP coach (EPIC-067 T-067-D1). Logika murni: template SOP yang
 * disusun dari pengaturan yang SEDANG BERLAKU (supaya isi dokumen selalu
 * sama dengan perilaku sistem) dan pesan pengingat.
 */

import type { DisciplineRules } from "@/lib/studio/coach-discipline";
import { INCIDENT_KIND_LABEL } from "@/lib/studio/coach-discipline";
import type { NoticeRules } from "@/lib/studio/coach-leave";
import { NOTICE_LEAVE_TYPES } from "@/lib/studio/coach-leave";
import { COMPLAINT_CATEGORIES, COMPLAINT_CATEGORY_LABEL, type ComplaintSlaRules } from "@/lib/studio/complaints";
import { LEAVE_TYPE_LABELS } from "@/types/hris";

export const SOP_TITLE_MAX = 150;
export const SOP_BODY_MAX = 50_000;

export interface SopTemplateInput {
  noticeRules: NoticeRules;
  substituteResponseHours: number;
  memberNoticeMinHours: number;
  slaRules: ComplaintSlaRules;
  discipline: DisciplineRules;
}

const jam = (h: number) => (h % 24 === 0 && h >= 24 ? `${h / 24} hari` : `${h} jam`);

export const SOP_COACH_TEMPLATE_TITLE = "SOP Coach — Cuti, Ketidakhadiran & Penanganan Keluhan";

export function buildSopCoachTemplate(i: SopTemplateInput): string {
  const planned = NOTICE_LEAVE_TYPES.filter((t) => !i.noticeRules[t].allow_short_notice && i.noticeRules[t].min_days > 0);
  const flexible = NOTICE_LEAVE_TYPES.filter((t) => i.noticeRules[t].allow_short_notice);
  const d = i.discipline;
  return [
    "1. TUJUAN",
    "SOP ini memastikan kelas dan sesi Personal Training tidak pernah kosong karena coach berhalangan, member selalu mendapat kabar yang jelas, dan setiap keluhan pelanggan ditangani tuntas.",
    "",
    "2. PENGAJUAN CUTI & KETIDAKHADIRAN",
    "a. Semua cuti diajukan lewat Coach Portal (tab Cuti) atau Area Karyawan — bukan lewat chat pribadi.",
    "b. Minimal pemberitahuan (H-N = tanggal mulai paling cepat N hari setelah pengajuan):",
    ...planned.map((t) => `   • ${LEAVE_TYPE_LABELS[t]}: minimal H-${i.noticeRules[t].min_days}`),
    `c. ${flexible.map((t) => LEAVE_TYPE_LABELS[t]).join(", ")} boleh diajukan mendadak, tetapi wajib disertai alasan yang jelas (dan surat dokter untuk sakit bila ada). Pengajuan di bawah minimal pemberitahuan tercatat sebagai CUTI MENDADAK.`,
    "d. Bila sakit atau darurat di hari mengajar: kabari Program Director secepatnya, lalu ajukan di Coach Portal di hari yang sama.",
    "e. Program Director dapat menetapkan tanggal tertentu (mis. hari event) sebagai tanggal yang tidak boleh diambil cuti.",
    "",
    "3. PENGGANTI SESI",
    "a. Saat mengajukan cuti, Coach Portal menampilkan semua kelas dan sesi Personal Training yang terdampak.",
    `b. Coach yang cuti wajib meminta pengganti untuk setiap sesi. Calon pengganti menjawab di Coach Portal paling lambat ${jam(i.substituteResponseHours)} (dan tidak lewat 1 jam sebelum sesi).`,
    "c. Cuti baru disetujui Program Director setelah SEMUA sesi punya pengganti. Bila tidak ada yang bisa, Program Director menunjuk pengganti langsung atau memutuskan kelas dibatalkan.",
    "d. Pengganti yang sudah menerima wajib hadir dan mengajar sesuai standar kelas; komisi sesi itu menjadi milik pengganti.",
    "",
    "4. KABAR KE MEMBER",
    `a. Member yang sudah booking otomatis menerima WhatsApp saat coach diganti atau kelas dibatalkan, idealnya paling lambat ${i.memberNoticeMinHours} jam sebelum kelas.`,
    "b. Member boleh membatalkan booking tanpa penalti (kredit kembali) bila coach kelasnya diganti.",
    "",
    "5. SANKSI",
    "Pelanggaran dicatat dan berdampak pada KPI, komisi, dan Surat Peringatan (SP):",
    ...(["no_show", "short_notice_leave", "late"] as const).map((k) => `   • ${INCIDENT_KIND_LABEL[k]}: potongan ${d.deduction_percent[k]}% komisi bulan kejadian`),
    `   • Total potongan maksimal ${d.max_deduction_percent}% per bulan.`,
    `   • ${d.warning_threshold} pelanggaran dalam ${d.warning_window_days} hari → diusulkan SP berikutnya (SP1 → SP2 → SP3). SP berlaku 6 bulan.`,
    "   • Catatan dapat dibatalkan Program Director bila ada bukti yang sah (mis. surat dokter).",
    "",
    "6. PENANGANAN KELUHAN PELANGGAN",
    "a. Dengarkan sampai selesai, jangan berdebat, ucapkan terima kasih atas masukannya.",
    "b. Setiap keluhan dicatat sebagai tiket (front desk / WhatsApp) dengan kategori yang tepat. Coach yang menerima keluhan langsung meneruskannya ke front desk atau Program Director di hari yang sama.",
    "c. Batas waktu penanganan:",
    ...COMPLAINT_CATEGORIES.map((c) => `   • ${COMPLAINT_CATEGORY_LABEL[c]}: respons ≤ ${jam(i.slaRules[c].respond_hours)}, selesai ≤ ${jam(i.slaRules[c].resolve_hours)}`),
    "d. Tiket yang lewat batas waktu otomatis dieskalasi ke Head Coach / Ops.",
    "e. CEDERA: hentikan latihan, berikan pertolongan pertama, laporkan segera ke Program Director, dan catat sebagai keluhan kategori Cedera.",
    "",
    "7. MEMBER YANG BUTUH PERHATIAN KHUSUS",
    "a. Sebelum kelas, periksa penanda di roster Coach Portal (cedera, kondisi medis, hamil, pemula, VIP, pernah komplain) dan sesuaikan latihan.",
    "b. Catat penanda baru (mis. keluhan lutut) setelah sesi lewat tombol Catatan di roster.",
    "c. Data medis member bersifat rahasia: hanya untuk coach yang mengajar member tersebut, tidak boleh dibagikan ke pihak lain.",
    "",
    "8. KONFIRMASI",
    "Dengan menekan \"Saya sudah membaca dan setuju\", coach menyatakan telah membaca, memahami, dan akan menjalankan SOP ini.",
  ].join("\n");
}

export function sopReminderMessage(input: { coachName: string; title: string; version: number; portalUrl: string }): string {
  return [
    `NüHabit — SOP perlu dibaca`,
    `Halo ${input.coachName}, ada SOP yang perlu Anda baca dan konfirmasi:`,
    `${input.title} (versi ${input.version})`,
    "",
    `Buka Coach Portal: ${input.portalUrl}`,
  ].join("\n");
}
