import type { DbClient } from "@/lib/pg/types";

export type TopupXpMode = "fixed" | "per_amount";

export type PosLoyaltySettings = {
  id: string | null;
  ark_rate: number;
  topup_min_amount: number;
  topup_presets: number[];
  topup_xp_enabled: boolean;
  topup_xp_mode: TopupXpMode;
  topup_xp_value: number;
  topup_xp_amount_step: number;
  spend_xp_enabled: boolean;
  spend_xp_amount_step: number;
  spend_xp_min: number;
  updated_at?: string | null;
};

export const DEFAULT_POS_LOYALTY_SETTINGS: PosLoyaltySettings = {
  id: null,
  ark_rate: 1000,
  topup_min_amount: 10000,
  topup_presets: [50000, 100000, 200000, 500000, 1000000],
  topup_xp_enabled: true,
  topup_xp_mode: "per_amount",
  topup_xp_value: 1,
  topup_xp_amount_step: 10000,
  spend_xp_enabled: true,
  spend_xp_amount_step: 10000,
  spend_xp_min: 1,
  updated_at: null,
};

export const POS_LOYALTY_SETTINGS_SINGLETON_ID = "a0000000-0000-4000-8000-000000000001";

function toNumber(value: unknown, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toBool(value: unknown, fallback = false) {
  if (typeof value === "boolean") return value;
  if (value == null) return fallback;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1") return true;
    if (normalized === "false" || normalized === "0") return false;
  }
  return Boolean(value);
}

export function normalizeTopupPresets(raw: unknown): number[] {
  const list = Array.isArray(raw)
    ? raw
    : typeof raw === "string"
      ? (() => {
          try {
            return JSON.parse(raw) as unknown;
          } catch {
            return [];
          }
        })()
      : [];

  const presets = (Array.isArray(list) ? list : [])
    .map((item) => Math.round(toNumber(item)))
    .filter((item) => item > 0);

  const unique = Array.from(new Set(presets)).sort((a, b) => a - b);
  return unique.length > 0 ? unique : [...DEFAULT_POS_LOYALTY_SETTINGS.topup_presets];
}

export function normalizeLoyaltySettings(row: Record<string, unknown> | null | undefined): PosLoyaltySettings {
  if (!row) return { ...DEFAULT_POS_LOYALTY_SETTINGS };

  const modeRaw = String(row.topup_xp_mode || "per_amount").toLowerCase();
  const topup_xp_mode: TopupXpMode = modeRaw === "fixed" ? "fixed" : "per_amount";

  return {
    id: row.id != null ? String(row.id) : null,
    ark_rate: Math.max(1, toNumber(row.ark_rate, DEFAULT_POS_LOYALTY_SETTINGS.ark_rate)),
    topup_min_amount: Math.max(0, toNumber(row.topup_min_amount, DEFAULT_POS_LOYALTY_SETTINGS.topup_min_amount)),
    topup_presets: normalizeTopupPresets(row.topup_presets),
    topup_xp_enabled: toBool(row.topup_xp_enabled, DEFAULT_POS_LOYALTY_SETTINGS.topup_xp_enabled),
    topup_xp_mode,
    topup_xp_value: Math.max(0, toNumber(row.topup_xp_value, DEFAULT_POS_LOYALTY_SETTINGS.topup_xp_value)),
    topup_xp_amount_step: Math.max(
      1,
      toNumber(row.topup_xp_amount_step, DEFAULT_POS_LOYALTY_SETTINGS.topup_xp_amount_step)
    ),
    spend_xp_enabled: toBool(row.spend_xp_enabled, DEFAULT_POS_LOYALTY_SETTINGS.spend_xp_enabled),
    spend_xp_amount_step: Math.max(
      1,
      toNumber(row.spend_xp_amount_step, DEFAULT_POS_LOYALTY_SETTINGS.spend_xp_amount_step)
    ),
    spend_xp_min: Math.max(0, Math.floor(toNumber(row.spend_xp_min, DEFAULT_POS_LOYALTY_SETTINGS.spend_xp_min))),
    updated_at: row.updated_at != null ? String(row.updated_at) : null,
  };
}

/** Convert stored IDR-equivalent balance to ARK display units. */
export function idrToArk(amountIdr: number, arkRate: number) {
  const rate = Math.max(1, arkRate || DEFAULT_POS_LOYALTY_SETTINGS.ark_rate);
  return (Number(amountIdr) || 0) / rate;
}

export function formatArkAmount(amountIdr: number, arkRate: number) {
  return `${idrToArk(amountIdr, arkRate).toLocaleString("id-ID")} ARK`;
}

/**
 * ARK bulat untuk TAMPILAN saja — pecahan ≥ 0,5 dibulatkan ke atas, sisanya ke
 * bawah (Rp 2.600 → 3 ARK, Rp 2.400 → 2 ARK pada rate 1.000). Pembulatan
 * memakai nilai mutlak agar transaksi negatif ikut membesar magnitudonya
 * (−Rp 2.500 → −3 ARK), bukan bergeser ke arah nol seperti Math.round.
 *
 * JANGAN dipakai untuk aritmetika saldo/pembayaran — nilai simpanan tetap
 * Rupiah dan kasir memotongnya 1:1.
 */
export function idrToArkDisplay(amountIdr: number, arkRate: number) {
  const ark = idrToArk(amountIdr, arkRate);
  return Math.sign(ark) * Math.round(Math.abs(ark));
}

/**
 * Deteksi pembayaran ARK Coin dari string metode APA PUN yang sampai ke struk:
 * kode internal 'ark_coin' ATAU label tampilan "ARK Coin" (formatPaymentMethod-
 * Label / katalog). Struk kasir live mengirim labelnya, bukan kodenya — cek
 * `=== "ark_coin"` saja membuat konversi ARK tidak pernah tercetak di sana.
 */
export function isArkCoinMethod(method?: string | null) {
  return /^ark[\s_-]?coins?$/i.test(String(method || "").trim());
}

export function calculateTopupXp(amountIdr: number, settings: Pick<
  PosLoyaltySettings,
  "topup_xp_enabled" | "topup_xp_mode" | "topup_xp_value" | "topup_xp_amount_step"
>) {
  if (!settings.topup_xp_enabled) return 0;
  const amount = Math.max(0, Number(amountIdr) || 0);
  if (amount <= 0) return 0;

  if (settings.topup_xp_mode === "fixed") {
    return Math.max(0, Math.floor(settings.topup_xp_value));
  }

  const step = Math.max(1, settings.topup_xp_amount_step);
  const value = Math.max(0, settings.topup_xp_value);
  return Math.max(0, Math.floor(amount / step) * value);
}

export function calculateSpendXp(
  orderTotalIdr: number,
  settings: Pick<PosLoyaltySettings, "spend_xp_enabled" | "spend_xp_amount_step" | "spend_xp_min">
) {
  if (!settings.spend_xp_enabled) return 0;
  const amount = Math.max(0, Number(orderTotalIdr) || 0);
  if (amount <= 0) return 0;

  const step = Math.max(1, settings.spend_xp_amount_step);
  const raw = Math.floor(amount / step);
  return Math.max(settings.spend_xp_min, raw);
}

export async function loadPosLoyaltySettings(db: Pick<DbClient, "from">): Promise<PosLoyaltySettings> {
  try {
    const { data, error } = await db
      .from("pos_loyalty_settings")
      .select("*")
      .eq("is_active", true)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      if (error.code === "42P01" || /does not exist/i.test(String(error.message || ""))) {
        return { ...DEFAULT_POS_LOYALTY_SETTINGS };
      }
      throw error;
    }

    return normalizeLoyaltySettings(data as Record<string, unknown> | null);
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "42P01"
    ) {
      return { ...DEFAULT_POS_LOYALTY_SETTINGS };
    }
    throw error;
  }
}

export type PosLoyaltySettingsInput = Omit<PosLoyaltySettings, "id" | "updated_at">;

/** Simpan baris singleton pengaturan ARK & XP (update bila ada, insert bila belum). */
export async function savePosLoyaltySettings(
  db: Pick<DbClient, "from">,
  input: PosLoyaltySettingsInput,
  userId: string
): Promise<PosLoyaltySettings> {
  const payload = {
    id: POS_LOYALTY_SETTINGS_SINGLETON_ID,
    ...input,
    topup_presets: JSON.stringify(normalizeTopupPresets(input.topup_presets)),
    is_active: true,
    updated_by: userId,
    updated_at: new Date().toISOString(),
  };

  const existing = await db
    .from("pos_loyalty_settings")
    .select("id")
    .eq("id", POS_LOYALTY_SETTINGS_SINGLETON_ID)
    .maybeSingle();
  if (existing.error && existing.error.code !== "42P01") throw existing.error;

  const { data, error } = existing.data
    ? await db
        .from("pos_loyalty_settings")
        .update(payload)
        .eq("id", POS_LOYALTY_SETTINGS_SINGLETON_ID)
        .select("*")
        .single()
    : await db.from("pos_loyalty_settings").insert(payload).select("*").single();
  if (error) throw new Error(error.message || "Failed to save loyalty settings");
  return normalizeLoyaltySettings(data as Record<string, unknown>);
}
