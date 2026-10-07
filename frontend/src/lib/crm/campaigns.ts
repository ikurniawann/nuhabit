// EPIC-033 — logika murni kampanye WA (tanpa DB, pola pricing/capacity):
// normalisasi aturan segmen, builder filter SQL ter-parameter, render
// template pesan, dan jendela jam kirim. Keputusan owner 26 Jul: segmen
// MVP = last_visit ≥ N hari + tier + min XP; opt-out best practice
// (footer STOP di SETIAP pesan marketing).

export interface CampaignSegment {
  /** Win-back: terakhir kunjungan ≥ N hari lalu. null = tanpa filter. */
  last_visit_days: number | null;
  /** Kode membership_tier yang disasar. [] = semua tier. */
  tiers: string[];
  /** XP minimum. null = tanpa filter. */
  min_xp: number | null;
}

/**
 * Normalisasi input segmen dari klien: sampah DIBUANG (jadi null/[]),
 * bukan diam-diam jadi 0 — pelajaran bug sales-target EPIC-021.
 */
export function normalizeSegment(raw: unknown): CampaignSegment {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const intOrNull = (v: unknown): number | null => {
    const n = typeof v === "number" ? Math.floor(v) : NaN;
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  return {
    last_visit_days: intOrNull(obj.last_visit_days),
    tiers: Array.isArray(obj.tiers)
      ? obj.tiers.filter((t): t is string => typeof t === "string" && t !== "")
      : [],
    min_xp: intOrNull(obj.min_xp),
  };
}

export interface SegmentFilter {
  /** Fragmen WHERE (tanpa kata WHERE), alias tabel = c (pos_customers). */
  where: string;
  params: unknown[];
}

/**
 * Filter SQL ter-parameter utk pos_customers (alias `c`). `startIndex` =
 * nomor placeholder pertama yang boleh dipakai ($N) — pemanggil biasanya
 * sudah memakai $1..$(startIndex-1) utk scope venue.
 * Guard dasar selalu ada: member aktif + punya nomor WA.
 */
export function buildSegmentFilter(
  segment: CampaignSegment,
  startIndex: number
): SegmentFilter {
  const clauses = [
    "c.is_active = true",
    "c.phone IS NOT NULL",
    "length(trim(c.phone)) >= 8",
  ];
  const params: unknown[] = [];
  let i = startIndex;
  if (segment.last_visit_days !== null) {
    // Win-back = pernah datang TAPI sudah lama — yang belum pernah datang
    // bukan target win-back
    clauses.push("c.last_visit IS NOT NULL");
    clauses.push(`c.last_visit <= now() - ($${i} || ' days')::interval`);
    params.push(segment.last_visit_days);
    i += 1;
  }
  if (segment.tiers.length > 0) {
    clauses.push(`c.membership_tier = ANY($${i})`);
    params.push(segment.tiers);
    i += 1;
  }
  if (segment.min_xp !== null) {
    clauses.push(`COALESCE(c.total_xp, 0) >= $${i}`);
    params.push(segment.min_xp);
    i += 1;
  }
  return { where: clauses.join(" AND "), params };
}

/** Footer opt-out — WAJIB menempel di setiap pesan marketing (best practice). */
export const OPTOUT_FOOTER =
  "\n\n_Balas STOP untuk berhenti menerima info promo._";

/**
 * Render pesan final per penerima: {nama} & {kode} terganti, sisa
 * placeholder kode dibersihkan bila kampanye tanpa voucher, footer
 * opt-out selalu ditambahkan.
 */
export function renderCampaignMessage(
  template: string,
  data: { nama: string; kode: string | null }
): string {
  let message = template.split("{nama}").join(data.nama);
  message = data.kode
    ? message.split("{kode}").join(data.kode)
    : message.split("{kode}").join("").replace(/[ \t]{2,}/g, " ").trim();
  return `${message}${OPTOUT_FOOTER}`;
}

export type TemplateIssue = "template-tanpa-kode" | "kode-tanpa-promo";

/**
 * Validasi template vs mode promo: batch (voucher per penerima) wajib
 * menyebut {kode}; kampanye tanpa promo dilarang memuat {kode} (pesan
 * bolong sampai ke member).
 */
export function validateTemplate(
  template: string,
  promoMode: "public" | "batch" | null
): { ok: true } | { ok: false; reason: TemplateIssue } {
  const hasKode = template.includes("{kode}");
  if (promoMode === "batch" && !hasKode) {
    return { ok: false, reason: "template-tanpa-kode" };
  }
  if (promoMode === null && hasKode) {
    return { ok: false, reason: "kode-tanpa-promo" };
  }
  return { ok: true };
}

/** Jam kirim sopan 8–21 WIB (pola ambang EPIC-020). */
export function isWithinSendWindow(hourWib: number): boolean {
  return hourWib >= 8 && hourWib < 21;
}

/** Konfigurasi pengirim — app_settings `crm_campaign_config`. */
export interface CampaignConfig {
  /** Master switch — default MATI (keputusan owner: WA official disiapkan). */
  enabled: boolean;
  /** Plafon kirim global per hari per venue (lintas kampanye). */
  daily_cap: number;
}

export const DEFAULT_CAMPAIGN_CONFIG: CampaignConfig = {
  enabled: false,
  daily_cap: 150,
};

/** Parse config dari app_settings — nilai rusak jatuh ke default aman. */
export function parseCampaignConfig(raw: unknown): CampaignConfig {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const cap =
    typeof obj.daily_cap === "number" && Number.isFinite(obj.daily_cap)
      ? Math.min(2000, Math.max(1, Math.floor(obj.daily_cap)))
      : DEFAULT_CAMPAIGN_CONFIG.daily_cap;
  return { enabled: obj.enabled === true, daily_cap: cap };
}

/* ── Kanal, jadwal, dan pembatalan otomatis ───────────────────────────── */

export const CAMPAIGN_CHANNELS = ["wa", "in_app"] as const;
export type CampaignChannel = (typeof CAMPAIGN_CHANNELS)[number];

/** Kanal valid tanpa duplikat; input kosong/rusak jatuh ke WA (perilaku lama). */
export function normalizeChannels(raw: unknown): CampaignChannel[] {
  const list = Array.isArray(raw) ? raw : [];
  const picked = CAMPAIGN_CHANNELS.filter((c) => list.includes(c));
  return picked.length > 0 ? [...picked] : ["wa"];
}

/** Jarak minimal jadwal dari sekarang, dan batas terjauhnya. */
export const SCHEDULE_MIN_LEAD_MS = 5 * 60_000;
export const SCHEDULE_MAX_LEAD_MS = 90 * 24 * 60 * 60_000;

export type ScheduleIssue = "jadwal-tidak-valid" | "jadwal-terlalu-dekat" | "jadwal-terlalu-jauh";

/** "Kirim nanti" minimal 5 menit dan maksimal 90 hari dari sekarang. */
export function validateSchedule(
  scheduledAt: string,
  now: Date
): { ok: true; at: Date } | { ok: false; reason: ScheduleIssue } {
  const at = new Date(scheduledAt);
  if (Number.isNaN(at.getTime())) return { ok: false, reason: "jadwal-tidak-valid" };
  const lead = at.getTime() - now.getTime();
  if (lead < SCHEDULE_MIN_LEAD_MS) return { ok: false, reason: "jadwal-terlalu-dekat" };
  if (lead > SCHEDULE_MAX_LEAD_MS) return { ok: false, reason: "jadwal-terlalu-jauh" };
  return { ok: true, at };
}

export const SCHEDULE_ISSUE_MESSAGES: Record<ScheduleIssue, string> = {
  "jadwal-tidak-valid": "Waktu kirim tidak valid",
  "jadwal-terlalu-dekat": "Waktu kirim minimal 5 menit dari sekarang",
  "jadwal-terlalu-jauh": "Waktu kirim maksimal 90 hari dari sekarang",
};

/**
 * Kampanye terjadwal yang sudah waktunya dimulai, urut paling lama menunggu.
 * Status selain `scheduled` (mis. dibatalkan setelah dijadwalkan) diabaikan.
 */
export function selectDueCampaigns<T extends { status: string; scheduled_at: string | Date | null }>(
  campaigns: T[],
  now: Date
): T[] {
  return campaigns
    .filter((c) => c.status === "scheduled" && c.scheduled_at !== null)
    .filter((c) => new Date(c.scheduled_at as string | Date).getTime() <= now.getTime())
    .sort(
      (a, b) =>
        new Date(a.scheduled_at as string | Date).getTime() -
        new Date(b.scheduled_at as string | Date).getTime()
    );
}

/** Kegagalan WA beruntun yang membuat kampanye dihentikan (status failed). */
export const ABORT_AFTER_CONSECUTIVE_FAILURES = 10;

/**
 * Hentikan kampanye bila N percobaan kirim terakhir semuanya gagal: gateway
 * mati atau nomor diblokir, dan mengirim terus hanya membakar antrean.
 * `recent` = status percobaan terbaru lebih dulu.
 */
export function shouldAbortCampaign(
  recent: Array<"sent" | "failed">,
  threshold = ABORT_AFTER_CONSECUTIVE_FAILURES
): boolean {
  if (recent.length < threshold) return false;
  return recent.slice(0, threshold).every((s) => s === "failed");
}

/** Isi notifikasi in-app: placeholder sama dengan WA, tanpa footer STOP. */
export function renderInAppBody(
  template: string,
  data: { nama: string; kode: string | null }
): string {
  return renderCampaignMessage(template, data).slice(0, -OPTOUT_FOOTER.length);
}

/**
 * Tautan notifikasi in-app: path portal ("/member/...") atau URL http(s).
 * Protocol-relative ("//host") dan skema lain (javascript:) ditolak.
 */
export function isSafeLink(url: string): boolean {
  const value = url.trim();
  if (value.startsWith("/")) return !value.startsWith("//");
  return /^https?:\/\/[^\s/]+/i.test(value);
}
