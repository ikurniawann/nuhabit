// Resolver harga tiket v2 (EPIC-023 Revisi Manage Ticket): harga hidup di
// VARIAN produk ticket (Regular & High Season per varian), musim & blok
// online dari kalender per ticket, dan kanal bisa punya harga override.
// Fungsi murni tanpa DB agar mudah diuji — pemanggil menyuplai data yang
// sudah ter-scope venue.

export type SeasonKind = "regular" | "high";
export type ProductDateKind = "high-season" | "blok-online";

export interface ProductDateRange {
  date_kind: ProductDateKind;
  start_date: string; // YYYY-MM-DD inklusif
  end_date: string; // YYYY-MM-DD inklusif
  is_active: boolean;
}

/** Pasangan harga Regular/High — null = belum diisi (WAJIB tolak). */
export interface PricePair {
  price_regular: number | null;
  price_high: number | null;
}

/** Valid bila string YYYY-MM-DD adalah tanggal kalender sungguhan. */
export function isValidCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  );
}

const isDateInRange = (date: string, range: ProductDateRange) =>
  range.is_active && range.start_date <= date && date <= range.end_date;

/**
 * Musim untuk satu tanggal menurut kalender TICKET ybs: masuk rentang
 * `high-season` aktif → high; di luar semua rentang → regular.
 */
export function resolveSeasonKind(
  visitDate: string,
  dates: readonly ProductDateRange[]
): SeasonKind {
  if (!isValidCalendarDate(visitDate)) {
    throw new Error(`Tanggal kunjungan tidak valid: ${visitDate}`);
  }
  return dates.some((r) => r.date_kind === "high-season" && isDateInRange(visitDate, r))
    ? "high"
    : "regular";
}

/**
 * Tanggal diblok dari penjualan online? (kanal website menolak; walk-in
 * tetap jalan.)
 */
export function isDateBlockedOnline(
  visitDate: string,
  dates: readonly ProductDateRange[]
): boolean {
  if (!isValidCalendarDate(visitDate)) {
    throw new Error(`Tanggal kunjungan tidak valid: ${visitDate}`);
  }
  return dates.some(
    (r) => r.date_kind === "blok-online" && isDateInRange(visitDate, r)
  );
}

const priceForSeason = (pair: PricePair | null | undefined, season: SeasonKind) => {
  if (!pair) return null;
  return season === "high" ? pair.price_high : pair.price_regular;
};

/**
 * Harga pasti untuk (varian, musim, kanal): override kanal menang bila
 * terisi, selain itu harga varian. Null = harga belum diisi — pemanggil
 * WAJIB menolak transaksi, jangan menebak harga.
 */
export function resolveVariantPrice(input: {
  variant: PricePair;
  channelOverride?: PricePair | null;
  seasonKind: SeasonKind;
}): number | null {
  const override = priceForSeason(input.channelOverride, input.seasonKind);
  if (override !== null && override !== undefined) return override;
  return priceForSeason(input.variant, input.seasonKind);
}

export interface ResolveTicketPriceInput {
  visitDate: string;
  /** true bila kanal penjualan online (website) — kena blok-online. */
  isOnlineChannel: boolean;
  dates: readonly ProductDateRange[];
  variant: PricePair;
  channelOverride?: PricePair | null;
}

export type ResolveTicketPriceResult =
  | { ok: true; price: number; seasonKind: SeasonKind }
  | { ok: false; reason: "tanggal-diblok" | "harga-belum-diisi" };

/** Resolusi lengkap satu tanggal: blok online → musim → harga. */
export function resolveTicketPrice(
  input: ResolveTicketPriceInput
): ResolveTicketPriceResult {
  if (input.isOnlineChannel && isDateBlockedOnline(input.visitDate, input.dates)) {
    return { ok: false, reason: "tanggal-diblok" };
  }
  const seasonKind = resolveSeasonKind(input.visitDate, input.dates);
  const price = resolveVariantPrice({
    variant: input.variant,
    channelOverride: input.channelOverride,
    seasonKind,
  });
  if (price === null || price === undefined) {
    return { ok: false, reason: "harga-belum-diisi" };
  }
  return { ok: true, price, seasonKind };
}

/**
 * Varian dianggap "lengkap harga" bila Regular & High terisi (langsung
 * di varian ATAU tertutup override kanal ybs) — dipakai guard distribusi
 * Channel Manager (Fase R2).
 */
export function isVariantPriceComplete(
  variant: PricePair,
  channelOverride?: PricePair | null
): boolean {
  return (["regular", "high"] as const).every(
    (season) =>
      resolveVariantPrice({ variant, channelOverride, seasonKind: season }) !== null
  );
}
