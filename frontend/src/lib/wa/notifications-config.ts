/**
 * Konfigurasi notifikasi WhatsApp untuk owner (EPIC-020).
 *
 * Disimpan sebagai satu JSON di configuration.app_settings key
 * `wa_notif_config`. Murni tanpa I/O supaya bisa diuji — pembacaan/penulisan
 * settingnya di route API.
 */

export type WaNotifType =
  | "digest"
  | "voidBesar"
  | "stokHabis"
  | "komplain"
  | "reviewRendah"
  | "omzetAnjlok"
  | "approvalMenginap"
  | "kontrakHabis"
  | "prMendesak";

export interface WaNotifTypeMeta {
  key: WaNotifType;
  label: string;
  description: string;
  /** Pengelompokan di UI: kritis dikirim seketika, digest terjadwal, ambang saat melewati batas. */
  tier: "kritis" | "harian" | "ambang";
  defaultOn: boolean;
}

export const WA_NOTIF_TYPES: WaNotifTypeMeta[] = [
  {
    key: "voidBesar",
    label: "Pesanan di-void bernilai besar",
    description: "Void/pembatalan di atas ambang nominal — sinyal fraud paling umum di POS.",
    tier: "kritis",
    defaultOn: true,
  },
  {
    key: "stokHabis",
    label: "Stok bahan benar-benar habis",
    description: "Bahan mencapai nol (bukan sekadar di bawah minimum) — operasional berhenti.",
    tier: "kritis",
    defaultOn: true,
  },
  {
    key: "komplain",
    label: "Komplain pelanggan masuk",
    description: "Komplain baru dari WhatsApp Customer Service.",
    tier: "kritis",
    defaultOn: true,
  },
  {
    key: "prMendesak",
    label: "Purchase Request mendesak",
    description:
      "PR berprioritas Mendesak dibuat atau diajukan — butuh persetujuan cepat (permintaan owner 2026-09-04).",
    tier: "kritis",
    defaultOn: true,
  },
  {
    key: "reviewRendah",
    label: "Review Google bintang rendah",
    description: "Review masuk dengan rating ≤ 2 — reputasi butuh respons cepat.",
    tier: "kritis",
    defaultOn: true,
  },
  {
    key: "digest",
    label: "Ringkasan harian jam tutup",
    description: "Satu pesan: omzet vs kemarin, kehadiran, antrean keputusan, stok menipis.",
    tier: "harian",
    defaultOn: true,
  },
  {
    key: "omzetAnjlok",
    label: "Omzet bulan berjalan anjlok",
    description:
      "Omzet month-to-date jauh di bawah pace target bulanan (bila diisi) atau MTD bulan lalu — keputusan owner 2026-07-22.",
    tier: "ambang",
    defaultOn: true,
  },
  {
    key: "approvalMenginap",
    label: "Approval menginap",
    description: "Pengajuan cuti/lembur/pinjaman/PO yang menunggu lebih dari 2 hari.",
    tier: "ambang",
    defaultOn: true,
  },
  {
    key: "kontrakHabis",
    label: "Kontrak karyawan mendekati habis",
    description: "Kontrak PKWT yang berakhir dalam 30 hari.",
    tier: "ambang",
    defaultOn: true,
  },
];

export interface WaNotifConfig {
  /** Saklar utama — mematikan semuanya tanpa kehilangan pilihan per jenis. */
  enabled: boolean;
  /** Nomor penerima, format 62xxxxxxxxxx. */
  recipients: string[];
  types: Record<WaNotifType, boolean>;
  /** Ambang nominal void yang dianggap "besar" (Rp). */
  voidThresholdRp: number;
  /** Jam WIB (0-23) pengiriman ringkasan harian — default jam tutup 22:00. */
  digestHour: number;
  /** Omzet MTD dianggap anjlok bila < persen ini dari baseline (1-99). */
  omzetAnjlokPct: number;
}

export const WA_NOTIF_SETTING_KEY = "wa_notif_config";
export const DEFAULT_VOID_THRESHOLD_RP = 500_000;
export const DEFAULT_DIGEST_HOUR = 22;
export const DEFAULT_OMZET_ANJLOK_PCT = 80;
export const MAX_RECIPIENTS = 5;

export function defaultWaNotifConfig(): WaNotifConfig {
  return {
    enabled: false, // aktif hanya setelah owner sadar menyalakannya
    recipients: [],
    types: Object.fromEntries(WA_NOTIF_TYPES.map((t) => [t.key, t.defaultOn])) as Record<
      WaNotifType,
      boolean
    >,
    voidThresholdRp: DEFAULT_VOID_THRESHOLD_RP,
    digestHour: DEFAULT_DIGEST_HOUR,
    omzetAnjlokPct: DEFAULT_OMZET_ANJLOK_PCT,
  };
}

/**
 * Normalisasi nomor Indonesia → 62xxxxxxxxxx.
 * Menerima 08…, +62…, 62…, dengan spasi/strip. null = tidak valid.
 */
export function normalizeWaRecipient(raw: string): string | null {
  const digits = raw.replace(/[^\d+]/g, "");
  let n = digits.startsWith("+") ? digits.slice(1) : digits;
  if (n.startsWith("0")) n = `62${n.slice(1)}`;
  if (!n.startsWith("62")) return null;
  // 62 + 8-13 digit — ponsel Indonesia yang masuk akal
  if (!/^62\d{8,13}$/.test(n)) return null;
  return n;
}

/**
 * Baca nilai tersimpan (string JSON atau null) → config valid.
 * Nilai rusak/parsial jatuh ke default per-field, bukan meledak: setting lama
 * tidak boleh membuat halaman pengaturan tak bisa dibuka.
 */
export function parseWaNotifConfig(raw: string | null): WaNotifConfig {
  const base = defaultWaNotifConfig();
  if (!raw) return base;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return base;
  }
  if (!parsed || typeof parsed !== "object") return base;
  const o = parsed as Record<string, unknown>;

  const recipients = Array.isArray(o.recipients)
    ? o.recipients
        .map((r) => (typeof r === "string" ? normalizeWaRecipient(r) : null))
        .filter((r): r is string => r !== null)
        .slice(0, MAX_RECIPIENTS)
    : base.recipients;

  const types = { ...base.types };
  if (o.types && typeof o.types === "object") {
    for (const meta of WA_NOTIF_TYPES) {
      const v = (o.types as Record<string, unknown>)[meta.key];
      if (typeof v === "boolean") types[meta.key] = v;
    }
  }

  const threshold =
    typeof o.voidThresholdRp === "number" && Number.isFinite(o.voidThresholdRp) && o.voidThresholdRp >= 0
      ? Math.round(o.voidThresholdRp)
      : base.voidThresholdRp;

  const digestHour =
    typeof o.digestHour === "number" &&
    Number.isInteger(o.digestHour) &&
    o.digestHour >= 0 &&
    o.digestHour <= 23
      ? o.digestHour
      : base.digestHour;

  const omzetAnjlokPct =
    typeof o.omzetAnjlokPct === "number" &&
    Number.isInteger(o.omzetAnjlokPct) &&
    o.omzetAnjlokPct >= 1 &&
    o.omzetAnjlokPct <= 99
      ? o.omzetAnjlokPct
      : base.omzetAnjlokPct;

  return {
    enabled: typeof o.enabled === "boolean" ? o.enabled : base.enabled,
    recipients: [...new Set(recipients)],
    types,
    voidThresholdRp: threshold,
    digestHour,
    omzetAnjlokPct,
  };
}
