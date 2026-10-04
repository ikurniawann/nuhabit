/**
 * Lapisan pengiriman WhatsApp — netral terhadap penyedia.
 *
 * Dua penyedia didukung:
 * - `meta`   : WhatsApp Business Cloud API resmi (Meta). Pesan yang diinisiasi
 *              bisnis WAJIB memakai template yang sudah disetujui; teks bebas
 *              hanya boleh dalam jendela layanan 24 jam setelah member membalas.
 * - `gateway`: service WhatsApp mandiri milik sendiri (Baileys) di
 *              `services/wa-gateway`. Bebas kirim teks, tanpa pihak ketiga dan
 *              tanpa biaya langganan, tapi memakai protokol tidak resmi yang
 *              sama seperti Fonnte — risiko nomor diblokir tetap ada.
 * - `fonnte` : gateway tidak resmi pihak ketiga. Bebas kirim teks, tapi nomor
 *              berisiko diblokir WhatsApp dan pesan transit di server mereka.
 */

export type WhatsAppProvider = "meta" | "gateway" | "fonnte";

export interface WhatsAppResult {
  success: boolean;
  /** Alasan kegagalan yang aman ditampilkan di log (tanpa isi pesan). */
  reason?: string;
  /**
   * Status kirim tidak pasti (request timeout — pesan mungkin saja sudah
   * terkirim). Pemanggil yang butuh at-most-once WAJIB cek flag ini,
   * jangan mencocokkan string `reason`.
   */
  timedOut?: boolean;
  provider?: WhatsAppProvider;
  messageId?: string;
}

export interface TextMessage {
  /** Nomor tujuan, digit saja, format 62xxx. */
  target: string;
  message: string;
}

export interface TemplateMessage {
  target: string;
  templateName: string;
  languageCode: string;
  /** Nilai untuk placeholder {{1}}, {{2}}, ... pada badan template. */
  bodyParameters: string[];
  /**
   * Template kategori AUTHENTICATION di Meta wajib punya tombol salin-kode,
   * dan tombol itu menerima kode yang sama seperti badan pesan.
   */
  copyCodeButton?: string;
}

/** Kanal percakapan CS (EPIC-013 Fase B). */
export const CS_CHANNELS = ["whatsapp", "instagram"] as const;
export type CsChannel = (typeof CS_CHANNELS)[number];

export const CHANNEL_LABELS: Record<CsChannel, string> = {
  whatsapp: "WhatsApp",
  instagram: "Instagram",
};
