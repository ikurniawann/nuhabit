// Distribusi ticket ke kanal (Channel Manager) dan opsi loket — logika
// murni di atas baris DB yang sudah dimuat. Harga numerik Postgres datang
// sebagai string; semua dinormalisasi ke number | null di sini.

import { addDaysIso } from "./calendar";
import { isVariantPriceComplete, type PricePair } from "./pricing";

const toNum = (v: string | null) => (v === null ? null : Number(v));

export interface VariantPriceRow {
  id: string;
  name: string;
  price_regular: string | null;
  price_high: string | null;
}

export interface ChannelOverrideRow {
  variant_id: string;
  price_regular: string | null;
  price_high: string | null;
}

const pairOf = (row: { price_regular: string | null; price_high: string | null }): PricePair => ({
  price_regular: toNum(row.price_regular),
  price_high: toNum(row.price_high),
});

/**
 * Varian aktif pertama yang harganya belum lengkap (Regular & High) untuk
 * satu kanal — langsung di varian atau tertutup override kanal. null =
 * semua lengkap (boleh didistribusikan).
 */
export function firstIncompleteVariant<V extends VariantPriceRow>(
  variants: readonly V[],
  overrides: readonly ChannelOverrideRow[]
): V | null {
  const overrideMap = new Map(overrides.map((o) => [o.variant_id, o]));
  return (
    variants.find((v) => {
      const o = overrideMap.get(v.id);
      return !isVariantPriceComplete(pairOf(v), o ? pairOf(o) : null);
    }) ?? null
  );
}

// ── Papan Channel Manager ─────────────────────────────────────────────

export interface BoardProductRow {
  id: string;
  code: string;
  name: string;
  status: "draft" | "active";
  product_kind: "single" | "bundle";
  thumbnail_url: string | null;
}

export interface BoardVariantRow extends VariantPriceRow {
  ticket_product_id: string;
}

export interface BoardChannelRow {
  id: string;
  code: string;
  name: string;
  is_online: boolean;
}

export interface BoardDistributionRow {
  ticket_product_id: string;
  channel_id: string;
  is_distributed: boolean;
}

export interface BoardOverrideRow extends ChannelOverrideRow {
  channel_id: string;
}

/**
 * Semua ticket × kanal venue: status distribusi, override harga per
 * varian, dan kelengkapan harga per kanal (guard distribusi dihitung
 * di sini juga supaya UI jujur dgn server).
 */
export function buildChannelBoard(input: {
  products: readonly BoardProductRow[];
  variants: readonly BoardVariantRow[];
  channels: readonly BoardChannelRow[];
  distributions: readonly BoardDistributionRow[];
  overrides: readonly BoardOverrideRow[];
}) {
  const key = (a: string, b: string) => `${a}|${b}`;
  const overrideMap = new Map(input.overrides.map((o) => [key(o.variant_id, o.channel_id), o]));
  const distributionMap = new Map(
    input.distributions.map((d) => [key(d.ticket_product_id, d.channel_id), d])
  );

  return input.products.map((product) => {
    const productVariants = input.variants.filter((v) => v.ticket_product_id === product.id);
    return {
      id: product.id,
      code: product.code,
      name: product.name,
      status: product.status,
      product_kind: product.product_kind,
      thumbnail_url: product.thumbnail_url,
      variants: productVariants.map((v) => ({ id: v.id, name: v.name, ...pairOf(v) })),
      channels: input.channels.map((channel) => {
        const channelOverrides = productVariants.map((v) => {
          const o = overrideMap.get(key(v.id, channel.id));
          return {
            variant_id: v.id,
            price_regular: o ? toNum(o.price_regular) : null,
            price_high: o ? toNum(o.price_high) : null,
          };
        });
        const priceComplete =
          productVariants.length > 0 &&
          productVariants.every((v, i) => isVariantPriceComplete(pairOf(v), channelOverrides[i]));
        return {
          channel_id: channel.id,
          channel_code: channel.code,
          channel_name: channel.name,
          is_online: channel.is_online,
          is_distributed: distributionMap.get(key(product.id, channel.id))?.is_distributed ?? false,
          price_complete: priceComplete,
          overrides: channelOverrides,
        };
      }),
    };
  });
}

// ── Opsi registrasi loket ─────────────────────────────────────────────

export interface LoketOptionRow {
  variant_id: string;
  variant_name: string;
  ticket_product_id: string;
  ticket_code: string;
  ticket_name: string;
  product_kind: "single" | "bundle";
  price_regular: string | null;
  price_high: string | null;
}

export interface LoketBundleMemberRow {
  bundle_product_id: string;
  component_variant_id: string;
  qty: number;
  product_name: string;
  variant_name: string;
  component_status: string;
  component_kind: string;
  variant_is_active: boolean;
}

const isSellableBundle = (members: readonly LoketBundleMemberRow[] | undefined) =>
  !!members &&
  members.length > 0 &&
  members.every(
    (m) => m.component_status === "active" && m.component_kind === "single" && m.variant_is_active
  );

/**
 * Opsi loket per varian aktif; paket menyertakan komposisinya (UI butuh
 * tahu berapa gelang per unit) dan paket berkomposisi tak layak
 * (kosong/komponen nonaktif) disembunyikan.
 */
export function buildLoketOptions(
  rows: readonly LoketOptionRow[],
  memberRows: readonly LoketBundleMemberRow[]
) {
  const membersByBundle = new Map<string, LoketBundleMemberRow[]>();
  for (const m of memberRows) {
    const list = membersByBundle.get(m.bundle_product_id) ?? [];
    list.push(m);
    membersByBundle.set(m.bundle_product_id, list);
  }

  return rows
    .filter(
      (row) =>
        row.product_kind !== "bundle" || isSellableBundle(membersByBundle.get(row.ticket_product_id))
    )
    .map((row) => {
      const members =
        row.product_kind === "bundle" ? (membersByBundle.get(row.ticket_product_id) ?? []) : [];
      return {
        ...row,
        ...pairOf(row),
        members: members.map((m) => ({
          component_variant_id: m.component_variant_id,
          qty: m.qty,
          label: `${m.product_name} — ${m.variant_name}`,
        })),
        members_per_unit: members.reduce((sum, m) => sum + m.qty, 0),
      };
    });
}

// ── Kalender ticket: hapus tanda satu tanggal ─────────────────────────

export type DateUnmarkPlan =
  | { kind: "delete" }
  | { kind: "set-start"; start: string }
  | { kind: "set-end"; end: string }
  | { kind: "split"; leftEnd: string; rightStart: string };

/**
 * Rencana menghapus tanda `date` dari satu rentang yang memuatnya:
 * baris sehari dihapus, tepi rentang digeser, tanggal di tengah rentang
 * membelah rentang jadi dua.
 */
export function planDateUnmark(
  range: { start_date: string; end_date: string },
  date: string
): DateUnmarkPlan {
  if (range.start_date === range.end_date) return { kind: "delete" };
  if (range.start_date === date) return { kind: "set-start", start: addDaysIso(date, 1) };
  if (range.end_date === date) return { kind: "set-end", end: addDaysIso(date, -1) };
  return { kind: "split", leftEnd: addDaysIso(date, -1), rightStart: addDaysIso(date, 1) };
}
