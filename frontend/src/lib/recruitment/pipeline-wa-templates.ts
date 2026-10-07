import type { WaTemplateKey } from "./pipeline-types";

/**
 * Template pesan WhatsApp panel aksi pipeline. Teks = salinan resmi HR;
 * kunci template tercatat di timeline Aktivitas kandidat.
 */

export interface WaTemplate {
  key: WaTemplateKey;
  label: string;
  build: (nama: string, posisi: string) => string;
}

const PENOLAKAN_SETELAH_TES: WaTemplate = {
  key: "penolakan",
  label: "Penolakan Halus",
  build: (nama, posisi) =>
    `Halo ${nama}, terima kasih atas waktu dan partisipasi Anda dalam proses seleksi posisi ${posisi}. ` +
    `Setelah pertimbangan, saat ini kami belum dapat melanjutkan proses Anda ke tahap berikutnya. ` +
    `Data Anda tetap kami simpan untuk peluang yang sesuai di masa mendatang. Semoga sukses selalu.`,
};

export const SCREENING_WA_TEMPLATES: WaTemplate[] = [
  {
    key: "undangan_screening",
    label: "Undangan Screening",
    build: (nama, posisi) =>
      `Halo ${nama}, terima kasih telah melamar posisi ${posisi} di perusahaan kami. ` +
      `Kami ingin mengundang Anda untuk sesi screening call singkat mengenai lamaran Anda. ` +
      `Mohon informasikan waktu yang nyaman untuk kami hubungi. Terima kasih.`,
  },
  {
    key: "lolos_psikotes",
    label: "Lolos → Psikotes",
    build: (nama, posisi) =>
      `Halo ${nama}, selamat! Anda dinyatakan lolos tahap screening untuk posisi ${posisi}. ` +
      `Tahap selanjutnya adalah psikotes — jadwal dan detailnya akan kami informasikan segera. ` +
      `Terima kasih.`,
  },
  {
    key: "penolakan",
    label: "Penolakan Halus",
    build: (nama, posisi) =>
      `Halo ${nama}, terima kasih atas waktu dan minat Anda pada posisi ${posisi}. ` +
      `Setelah pertimbangan, saat ini kami belum dapat melanjutkan proses Anda ke tahap berikutnya. ` +
      `Data Anda tetap kami simpan untuk peluang yang sesuai di masa mendatang. Semoga sukses selalu.`,
  },
];

export const PSIKOTES_WA_TEMPLATES: WaTemplate[] = [
  {
    key: "lolos_interview",
    label: "Lolos → Interview",
    build: (nama, posisi) =>
      `Halo ${nama}, selamat! Anda dinyatakan lolos tahap psikotes untuk posisi ${posisi}. ` +
      `Tahap selanjutnya adalah interview — jadwal dan detailnya akan kami informasikan segera. Terima kasih.`,
  },
  PENOLAKAN_SETELAH_TES,
];

export const INTERVIEW_WA_TEMPLATES: WaTemplate[] = [
  {
    key: "lolos_offer",
    label: "Lolos → Offer",
    build: (nama, posisi) =>
      `Halo ${nama}, selamat! Anda dinyatakan lolos tahap interview untuk posisi ${posisi}. ` +
      `Tahap selanjutnya adalah penawaran kerja — detailnya akan kami informasikan segera. Terima kasih.`,
  },
  PENOLAKAN_SETELAH_TES,
];

/** Tombol "WA Penolakan Halus" di panel Offer. */
export const OFFER_REJECTION_WA_TEMPLATE = PENOLAKAN_SETELAH_TES;

/** Pesan undangan bertoken (dialog kirim psikotes / interview / offer). */
export interface InviteMessageInput {
  nama: string;
  posisi: string;
  link: string;
  expiresDays: string | number;
}

export const INVITE_WA_MESSAGES = {
  undangan_psikotes: ({ nama, posisi, link, expiresDays }: InviteMessageInput) =>
    `Halo ${nama}, selamat! Anda diundang mengikuti psikotes online ` +
    `untuk posisi ${posisi}. Silakan kerjakan melalui link berikut: ${link} ` +
    `(berlaku ${expiresDays} hari). Kerjakan di tempat tenang dengan koneksi stabil. Terima kasih.`,
  undangan_interview: ({ nama, posisi, link, expiresDays }: InviteMessageInput) =>
    `Halo ${nama}, selamat! Anda diundang mengikuti interview online ` +
    `untuk posisi ${posisi}. Interview dipandu AI interviewer kami dengan suara — ` +
    `wajib menggunakan kamera & mikrofon. Silakan mulai melalui link berikut: ${link} ` +
    `(berlaku ${expiresDays} hari). Siapkan tempat tenang dengan koneksi stabil. Terima kasih.`,
  offer_terkirim: ({ nama, posisi, link, expiresDays }: InviteMessageInput) =>
    `Halo ${nama}, selamat! Kami dengan senang hati menawarkan Anda posisi ` +
    `${posisi}. Rincian penawaran (gaji, benefit, tanggal mulai) dapat Anda lihat dan ` +
    `respons langsung melalui link berikut: ${link} (berlaku ${expiresDays} hari). ` +
    `Kami tunggu kabar baiknya. Terima kasih.`,
} satisfies Partial<Record<WaTemplateKey, (input: InviteMessageInput) => string>>;

export type InviteTemplateKey = keyof typeof INVITE_WA_MESSAGES;
