/**
 * Channel penjualan per produk (pos_products.sales_channels). NULL/kosong =
 * dijual di semua channel (perilaku lama). Dipakai untuk menu "hanya GoFood"
 * (mis. bundling): produk tetap ada di POS supaya order GoFood terpetakan &
 * masuk KDS, tapi tidak tampil di kasir maupun self-order QR meja.
 */

export const SALES_CHANNEL_CODES = ["pos", "self_order", "gofood", "grabfood", "shopeefood"] as const;
export type SalesChannelCode = (typeof SALES_CHANNEL_CODES)[number];

export const SALES_CHANNEL_LABELS: Record<SalesChannelCode, string> = {
  pos: "Kasir",
  self_order: "Self-order",
  gofood: "GoFood",
  grabfood: "GrabFood",
  shopeefood: "ShopeeFood",
};

/** Preset yang ditawarkan di halaman Produk (value = kunci preset). */
export const SALES_CHANNEL_PRESETS: Array<{ key: string; label: string; channels: SalesChannelCode[] | null }> = [
  { key: "all", label: "Semua channel", channels: null },
  { key: "gofood", label: "Hanya GoFood", channels: ["gofood"] },
  { key: "offline", label: "Kasir & self-order", channels: ["pos", "self_order"] },
  { key: "pos", label: "Hanya kasir", channels: ["pos"] },
];

export function normalizeSalesChannels(value: unknown): SalesChannelCode[] | null {
  if (value == null) return null;
  const list = Array.isArray(value) ? value : typeof value === "string" ? parsePgArray(value) : [];
  const codes = [...new Set(list.map((item) => String(item).trim()))].filter((item): item is SalesChannelCode =>
    (SALES_CHANNEL_CODES as readonly string[]).includes(item)
  );
  return codes.length > 0 ? codes : null;
}

/** "{gofood,pos}" (teks array Postgres) → ["gofood","pos"]. */
function parsePgArray(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return [];
  return trimmed
    .slice(1, -1)
    .split(",")
    .map((item) => item.replace(/^"|"$/g, "").trim())
    .filter(Boolean);
}

export function isSoldIn(channels: unknown, code: SalesChannelCode): boolean {
  const list = normalizeSalesChannels(channels);
  return list === null || list.includes(code);
}

/** Potongan SQL (kode dari daftar tetap, bukan input pengguna). */
export function soldInSql(alias: string, code: SalesChannelCode): string {
  return `(${alias}.sales_channels IS NULL OR cardinality(${alias}.sales_channels) = 0 OR '${code}' = ANY(${alias}.sales_channels))`;
}

export function salesChannelPresetKey(channels: unknown): string {
  const list = normalizeSalesChannels(channels);
  if (list === null) return "all";
  const sorted = [...list].sort().join(",");
  const preset = SALES_CHANNEL_PRESETS.find((item) => item.channels && [...item.channels].sort().join(",") === sorted);
  return preset?.key ?? "custom";
}

export function salesChannelSummary(channels: unknown): string {
  const list = normalizeSalesChannels(channels);
  if (list === null) return "Semua channel";
  return list.map((code) => SALES_CHANNEL_LABELS[code]).join(", ");
}
