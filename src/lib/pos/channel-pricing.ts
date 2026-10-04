import { formatRupiah } from "@/lib/format";
/**
 * Harga per channel penjualan (GoFood/GrabFood/ShopeeFood) — fungsi murni,
 * dipakai server (sinkron katalog) dan halaman pengaturan (pratinjau).
 *
 * Harga channel = base_price + markup %, lalu DIBULATKAN ke kelipatan
 * (mis. Rp1.000) supaya tidak "keriting" (21.600 → 22.000). Owner boleh
 * menimpa per produk; varian & add-on selalu mengikuti aturan markup.
 */

export type RoundingStep = 1 | 100 | 500 | 1000;
export type RoundingMode = "up" | "nearest" | "down";

export const ROUNDING_STEPS: RoundingStep[] = [1, 100, 500, 1000];
export const ROUNDING_MODES: RoundingMode[] = ["up", "nearest", "down"];
export const MAX_MARKUP_PERCENT = 300;
export const MAX_CHANNEL_PRICE = 100_000_000;

export type ChannelRule = {
  code: string;
  name: string;
  markupPercent: number;
  roundingStep: RoundingStep;
  roundingMode: RoundingMode;
  /** false = channel memakai base_price apa adanya. */
  isActive: boolean;
};

export function roundToStep(value: number, step: RoundingStep, mode: RoundingMode): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  // Buang galat float (18000 × 1.2 = 21599.999…) sebelum dibulatkan ke atas.
  const clean = Math.round(value * 100) / 100;
  const units = clean / step;
  const rounded = mode === "up" ? Math.ceil(units) : mode === "down" ? Math.floor(units) : Math.round(units);
  return rounded * step;
}

/** Harga otomatis channel untuk satu nilai (harga produk atau tambahan varian/add-on). */
export function applyChannelMarkup(value: number, rule: Pick<ChannelRule, "markupPercent" | "roundingStep" | "roundingMode" | "isActive">): number {
  const base = Number(value) || 0;
  if (base <= 0) return 0;
  if (!rule.isActive) return Math.round(base);
  const marked = base * (1 + (Number(rule.markupPercent) || 0) / 100);
  // Tidak pernah turun di bawah harga dasar walau mode "ke bawah".
  return Math.max(Math.round(base), roundToStep(marked, rule.roundingStep, rule.roundingMode));
}

export type ResolvedChannelPrice = {
  base: number;
  auto: number;
  final: number;
  /** Harga ditimpa manual oleh owner. */
  isManual: boolean;
};

export function resolveChannelPrice(
  basePrice: number,
  rule: ChannelRule,
  override: number | null | undefined
): ResolvedChannelPrice {
  const base = Math.round(Number(basePrice) || 0);
  const auto = applyChannelMarkup(base, rule);
  const manual = Number(override);
  // Override hanya berlaku saat channel aktif — nonaktif = kembali ke harga dasar.
  const isManual = rule.isActive && Number.isFinite(manual) && manual > 0;
  return { base, auto, final: isManual ? Math.round(manual) : auto, isManual };
}

/** Selisih harga channel vs harga dasar, dalam persen (untuk ditampilkan). */
export function markupPercentOf(base: number, final: number): number | null {
  if (!base || base <= 0) return null;
  return Math.round(((final - base) / base) * 1000) / 10;
}

export function roundingLabel(step: RoundingStep, mode: RoundingMode): string {
  if (step === 1) return "Tanpa pembulatan";
  const nominal = formatRupiah(step);
  const direction = mode === "up" ? "ke atas" : mode === "down" ? "ke bawah" : "terdekat";
  return `Kelipatan ${nominal} ${direction}`;
}
