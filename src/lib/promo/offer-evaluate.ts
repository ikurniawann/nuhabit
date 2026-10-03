import type { OfferType } from "@/lib/promo/offer-rules";

export type OfferCartLine = {
  productId: string;
  quantity: number;
  unitPrice: number;
};

export type OfferEvalItem = {
  role: "component" | "buy" | "get" | "eligible";
  /** Kosong bila target berupa kategori (lihat expandCategoryTargets). */
  product_id: string;
  category_id?: string | null;
  qty: number;
};

export type OfferEvalRule = {
  id: string;
  offer_type: OfferType;
  name: string;
  description?: string | null;
  bundle_price?: number | null;
  buy_qty?: number | null;
  get_qty?: number | null;
  get_mode?: "same_as_buy" | "specific_products" | null;
  volume_basis?: "qty" | "spend" | null;
  volume_min?: number | null;
  discount_type?: "percent" | "fixed" | null;
  discount_value?: number | null;
  items: OfferEvalItem[];
  /** null/kosong = semua channel (kode SALES_CHANNEL_CODES). */
  sales_channels?: string[] | null;
  /** Hanya aktif bila kodenya diketik kasir (ctx.unlockedRuleIds). */
  requires_code?: boolean;
  /** Eksklusif = tidak bisa digabung; menang hanya bila >= gabungan lain. */
  is_exclusive?: boolean;
  /** Lebih tinggi = diproses lebih dulu (default 0). */
  priority?: number;
  max_uses?: number | null;
  /** Pemakaian hidup (held segar + captured) lintas order. */
  used_count?: number;
  max_uses_per_member?: number | null;
  /** Pemakaian hidup member transaksi ini (0 tanpa member). */
  member_used_count?: number;
};

export type OfferEvalContext = {
  /** Channel transaksi; undefined = abaikan batas channel. */
  channel?: string;
  /** Penawaran ber-kode yang sudah dibuka kasir. */
  unlockedRuleIds?: string[];
};

export type OfferSkipReason = "channel" | "kode" | "kuota-habis" | "limit-member";

export type AppliedOffer = {
  rule_id: string;
  offer_type: OfferType;
  name: string;
  discount: number;
  /** BXGY: unit yang digratiskan (untuk baris FREE di cart UI) */
  free_units?: Array<{ productId: string; qty: number; unitPrice: number }>;
};

export type OfferEvalResult = {
  offer_discount: number;
  applied: AppliedOffer[];
};

function qtyByProduct(lines: OfferCartLine[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const line of lines) {
    const id = String(line.productId || "");
    if (!id) continue;
    const q = Math.max(0, Number(line.quantity) || 0);
    if (q <= 0) continue;
    map.set(id, (map.get(id) || 0) + q);
  }
  return map;
}

function priceByProduct(lines: OfferCartLine[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const line of lines) {
    const id = String(line.productId || "");
    if (!id) continue;
    // Beberapa baris produk sama: simpan harga satuan tertinggi
    // (konservatif utk nilai item gratis).
    const existing = map.get(id);
    if (existing == null) {
      map.set(id, Math.max(0, Number(line.unitPrice) || 0));
    } else {
      map.set(id, Math.max(existing, Math.max(0, Number(line.unitPrice) || 0)));
    }
  }
  return map;
}

function cloneQty(src: Map<string, number>) {
  return new Map(src);
}

function consume(qtyMap: Map<string, number>, productId: string, need: number) {
  const have = qtyMap.get(productId) || 0;
  const take = Math.min(have, need);
  qtyMap.set(productId, have - take);
  return take;
}

function evalBundle(
  rule: OfferEvalRule,
  qtyMap: Map<string, number>,
  priceMap: Map<string, number>
): { discount: number; consume: Array<{ productId: string; qty: number }> } {
  const components = rule.items.filter((i) => i.role === "component");
  const bundlePrice = Math.max(0, Number(rule.bundle_price) || 0);
  if (components.length < 2 || bundlePrice <= 0) {
    return { discount: 0, consume: [] };
  }

  let sets = Infinity;
  for (const c of components) {
    const need = Math.max(0.001, Number(c.qty) || 1);
    const have = qtyMap.get(c.product_id) || 0;
    sets = Math.min(sets, Math.floor(have / need));
  }
  if (!Number.isFinite(sets) || sets <= 0) return { discount: 0, consume: [] };

  let retail = 0;
  const consumeList: Array<{ productId: string; qty: number }> = [];
  for (const c of components) {
    const perSet = Math.max(0.001, Number(c.qty) || 1);
    const used = perSet * sets;
    retail += (priceMap.get(c.product_id) || 0) * used;
    consumeList.push({ productId: c.product_id, qty: used });
  }
  const discount = Math.max(0, Math.floor(retail - bundlePrice * sets));
  return { discount, consume: consumeList };
}

function evalBxgy(
  rule: OfferEvalRule,
  qtyMap: Map<string, number>,
  priceMap: Map<string, number>
): {
  discount: number;
  consume: Array<{ productId: string; qty: number }>;
  free: Array<{ productId: string; qty: number }>;
} {
  const buyQty = Math.max(0, Math.floor(Number(rule.buy_qty) || 0));
  const getQty = Math.max(0, Math.floor(Number(rule.get_qty) || 0));
  if (buyQty <= 0 || getQty <= 0) return { discount: 0, consume: [], free: [] };

  const buyProducts = rule.items.filter((i) => i.role === "buy").map((i) => i.product_id);
  if (buyProducts.length === 0) return { discount: 0, consume: [], free: [] };

  const mode = rule.get_mode || "same_as_buy";
  let buyHave = 0;
  for (const id of buyProducts) buyHave += qtyMap.get(id) || 0;

  let times = 0;
  let freeUnits = 0;
  let paidUnits = 0;

  if (mode === "same_as_buy") {
    // Beli X gratis Y dari pool yang sama → cycle = X+Y
    const cycle = buyQty + getQty;
    times = Math.floor(buyHave / cycle);
    if (times <= 0) return { discount: 0, consume: [], free: [] };
    freeUnits = times * getQty;
    paidUnits = times * buyQty;
  } else {
    const getProducts = rule.items.filter((i) => i.role === "get").map((i) => i.product_id);
    if (getProducts.length === 0) return { discount: 0, consume: [], free: [] };
    times = Math.floor(buyHave / buyQty);
    if (times <= 0) return { discount: 0, consume: [], free: [] };
    freeUnits = times * getQty;
    paidUnits = times * buyQty;

    // Consume paid buy units
    const consumeList: Array<{ productId: string; qty: number }> = [];
    const freeList: Array<{ productId: string; qty: number }> = [];
    let buyNeed = paidUnits;
    const buyPriced = buyProducts
      .map((id) => ({ id, have: qtyMap.get(id) || 0, price: priceMap.get(id) || 0 }))
      .filter((p) => p.have > 0)
      .sort((a, b) => a.price - b.price);
    for (const b of buyPriced) {
      if (buyNeed <= 0) break;
      const take = Math.min(b.have, buyNeed);
      consumeList.push({ productId: b.id, qty: take });
      buyNeed -= take;
    }

    // Free from get pool (cheapest first)
    let remaining = freeUnits;
    let discount = 0;
    const getPriced = getProducts
      .map((id) => ({
        id,
        price: priceMap.get(id) || 0,
        have: qtyMap.get(id) || 0,
      }))
      .filter((p) => p.have > 0 && p.price > 0)
      .sort((a, b) => a.price - b.price);
    for (const p of getPriced) {
      if (remaining <= 0) break;
      const take = Math.min(p.have, remaining);
      discount += Math.floor(p.price * take);
      consumeList.push({ productId: p.id, qty: take });
      freeList.push({ productId: p.id, qty: take });
      remaining -= take;
    }
    return { discount: Math.max(0, discount), consume: consumeList, free: freeList };
  }

  // same_as_buy path
  const consumeList: Array<{ productId: string; qty: number }> = [];
  const freeList: Array<{ productId: string; qty: number }> = [];
  const pool = buyProducts
    .map((id) => ({
      id,
      price: priceMap.get(id) || 0,
      have: qtyMap.get(id) || 0,
    }))
    .filter((p) => p.have > 0)
    .sort((a, b) => a.price - b.price);

  // Reserve paid units first (most expensive paid = free cheapest)
  let payNeed = paidUnits;
  let freeNeed = freeUnits;
  // Take free from cheapest
  let discount = 0;
  for (const p of pool) {
    if (freeNeed <= 0) break;
    const take = Math.min(p.have, freeNeed);
    discount += Math.floor(p.price * take);
    consumeList.push({ productId: p.id, qty: take });
    freeList.push({ productId: p.id, qty: take });
    freeNeed -= take;
    p.have -= take;
  }
  for (const p of pool) {
    if (payNeed <= 0) break;
    const take = Math.min(p.have, payNeed);
    if (take <= 0) continue;
    consumeList.push({ productId: p.id, qty: take });
    payNeed -= take;
    p.have -= take;
  }

  return { discount: Math.max(0, discount), consume: consumeList, free: freeList };
}

function evalVolume(
  rule: OfferEvalRule,
  lines: OfferCartLine[]
): { discount: number; consume: Array<{ productId: string; qty: number }> } {
  const eligibleIds = rule.items
    .filter((i) => i.role === "eligible")
    .map((i) => i.product_id);
  const scoped =
    eligibleIds.length === 0
      ? lines
      : lines.filter((l) => eligibleIds.includes(l.productId));

  const basis = rule.volume_basis || "qty";
  const min = Math.max(0, Number(rule.volume_min) || 0);
  if (min <= 0) return { discount: 0, consume: [] };

  const totalQty = scoped.reduce((s, l) => s + Math.max(0, l.quantity), 0);
  const totalSpend = scoped.reduce(
    (s, l) => s + Math.max(0, l.quantity) * Math.max(0, l.unitPrice),
    0
  );

  const ok = basis === "spend" ? totalSpend >= min : totalQty >= min;
  if (!ok) return { discount: 0, consume: [] };

  const type = rule.discount_type;
  const value = Number(rule.discount_value) || 0;
  if (!type || value <= 0) return { discount: 0, consume: [] };

  const base = Math.floor(totalSpend);
  let discount = 0;
  if (type === "percent") {
    discount = Math.floor((base * Math.min(100, value)) / 100);
  } else {
    discount = Math.floor(value);
  }
  discount = Math.min(discount, base);

  // Volume doesn't exclusively reserve qty for other rules in greedy pass
  return { discount, consume: [] };
}

function evalOne(
  rule: OfferEvalRule,
  lines: OfferCartLine[],
  qtyMap: Map<string, number>,
  priceMap: Map<string, number>
) {
  if (rule.offer_type === "bundle") {
    const r = evalBundle(rule, qtyMap, priceMap);
    return { ...r, free: [] as Array<{ productId: string; qty: number }> };
  }
  if (rule.offer_type === "bxgy") return evalBxgy(rule, qtyMap, priceMap);
  if (rule.offer_type === "volume") {
    const r = evalVolume(rule, lines);
    return { ...r, free: [] as Array<{ productId: string; qty: number }> };
  }
  return {
    discount: 0,
    consume: [] as Array<{ productId: string; qty: number }>,
    free: [] as Array<{ productId: string; qty: number }>,
  };
}

/**
 * Syarat non-keranjang sebuah penawaran: channel, kode pembuka, kuota total
 * dan kuota per member. null = boleh dievaluasi. Kuota per member tanpa
 * member dihitung 0 (pola nuhabit promotions.go: MemberUses kosong).
 */
export function offerSkipReason(
  rule: OfferEvalRule,
  ctx: OfferEvalContext = {}
): OfferSkipReason | null {
  const channels = rule.sales_channels ?? [];
  if (ctx.channel && channels.length > 0 && !channels.includes(ctx.channel)) {
    return "channel";
  }
  if (rule.requires_code && !(ctx.unlockedRuleIds ?? []).includes(rule.id)) {
    return "kode";
  }
  return offerCapReason(rule);
}

/** Kuota total & per member — dipakai evaluator dan klaim saat order. */
export function offerCapReason(caps: {
  max_uses?: number | null;
  used_count?: number;
  max_uses_per_member?: number | null;
  member_used_count?: number;
}): "kuota-habis" | "limit-member" | null {
  if (caps.max_uses != null && (caps.used_count ?? 0) >= caps.max_uses) {
    return "kuota-habis";
  }
  if (
    caps.max_uses_per_member != null &&
    (caps.member_used_count ?? 0) >= caps.max_uses_per_member
  ) {
    return "limit-member";
  }
  return null;
}

/**
 * Ganti target kategori dgn produk anggotanya supaya evaluator cukup
 * bekerja per produk. Dipakai server (order) DAN endpoint kasir dengan peta
 * yang sama, sehingga hasil diskon klien = server.
 */
export function expandCategoryTargets(
  rules: OfferEvalRule[],
  productIdsByCategory: Map<string, string[]>
): OfferEvalRule[] {
  return rules.map((rule) => {
    if (!rule.items.some((item) => item.category_id)) return rule;
    const items: OfferEvalItem[] = [];
    const seen = new Set<string>();
    const push = (item: OfferEvalItem) => {
      const key = `${item.role}:${item.product_id}`;
      if (seen.has(key)) return;
      seen.add(key);
      items.push(item);
    };
    for (const item of rule.items) {
      if (!item.category_id) {
        push(item);
        continue;
      }
      const members = productIdsByCategory.get(item.category_id) ?? [];
      // Kategori kosong tetap jadi target yang tak cocok apa pun, supaya
      // volume tidak jatuh ke "semua item" saat daftarnya habis.
      if (members.length === 0) push({ ...item, product_id: "" });
      for (const productId of members) {
        push({ role: item.role, product_id: productId, qty: item.qty });
      }
    }
    return { ...rule, items };
  });
}

function byPriorityThenDiscount(
  a: { rule: OfferEvalRule; discount: number },
  b: { rule: OfferEvalRule; discount: number }
) {
  const priority = (b.rule.priority ?? 0) - (a.rule.priority ?? 0);
  return priority !== 0 ? priority : b.discount - a.discount;
}

/**
 * Greedy satu kelompok aturan yang boleh digabung: prioritas tertinggi
 * dulu, lalu diskon terbesar (prioritas sama = perilaku lama). Qty yang
 * sudah dipakai bundle/BXGY tidak dipakai ulang; volume tidak memesan qty
 * dan hanya volume terbaik yang dipertahankan.
 */
function stackOffers(lines: OfferCartLine[], rules: OfferEvalRule[]): AppliedOffer[] {
  const priceMap = priceByProduct(lines);
  const qtyMap = qtyByProduct(lines);
  const applied: AppliedOffer[] = [];

  const scored = rules
    .map((rule) => ({
      rule,
      discount: evalOne(rule, lines, cloneQty(qtyMap), priceMap).discount,
    }))
    .filter((r) => r.discount > 0)
    .sort(byPriorityThenDiscount);

  for (const { rule } of scored) {
    const { discount, consume: used, free } = evalOne(rule, lines, qtyMap, priceMap);
    if (discount <= 0) continue;
    if (rule.offer_type !== "volume") {
      const check = cloneQty(qtyMap);
      const enough = used.every((u) => consume(check, u.productId, u.qty) >= u.qty - 1e-9);
      if (!enough) continue;
      for (const u of used) consume(qtyMap, u.productId, u.qty);
    }
    applied.push({
      rule_id: rule.id,
      offer_type: rule.offer_type,
      name: rule.name,
      discount,
      free_units: free.map((f) => ({
        productId: f.productId,
        qty: f.qty,
        unitPrice: priceMap.get(f.productId) || 0,
      })),
    });
  }

  const volumes = applied.filter((a) => a.offer_type === "volume");
  if (volumes.length <= 1) return applied;
  const bestVol = volumes.reduce((a, b) => (a.discount >= b.discount ? a : b));
  return applied.filter((a) => a.offer_type !== "volume" || a.rule_id === bestVol.rule_id);
}

const sumDiscount = (applied: AppliedOffer[]) =>
  applied.reduce((s, a) => s + a.discount, 0);

/**
 * Terapkan penawaran aktif ke keranjang. Aturan penggabungan (port
 * nuhabit promotions.go): penawaran eksklusif tidak bisa digabung, jadi
 * engine menghitung penawaran eksklusif terpilih SENDIRIAN vs semua
 * penawaran non-eksklusif DIGABUNG, lalu memberi yang lebih besar
 * (seri = eksklusif). Eksklusif terpilih = prioritas tertinggi, lalu diskon
 * terbesar. Total diskon tidak pernah melebihi subtotal.
 */
export function evaluateOfferRules(
  lines: OfferCartLine[],
  rules: OfferEvalRule[],
  ctx: OfferEvalContext = {}
): OfferEvalResult {
  const usable = rules.filter((rule) => offerSkipReason(rule, ctx) === null);
  const stacked = stackOffers(lines, usable.filter((rule) => !rule.is_exclusive));
  const stackedTotal = sumDiscount(stacked);

  const exclusive = usable
    .filter((rule) => rule.is_exclusive)
    .map((rule) => {
      const applied = stackOffers(lines, [rule]);
      return { rule, applied, discount: sumDiscount(applied) };
    })
    .filter((candidate) => candidate.discount > 0)
    .sort(byPriorityThenDiscount)[0];

  const applied =
    exclusive && exclusive.discount >= stackedTotal ? exclusive.applied : stacked;

  const subtotal = Math.floor(
    lines.reduce(
      (s, l) => s + Math.max(0, Number(l.quantity) || 0) * Math.max(0, Number(l.unitPrice) || 0),
      0
    )
  );
  return { offer_discount: Math.min(sumDiscount(applied), subtotal), applied };
}

/** Alokasi qty gratis ke baris cart (per productId, FIFO). */
export function allocateFreeUnitsToCartLines<
  T extends { id: string; productId: string; quantity: number },
>(
  cart: T[],
  applied: AppliedOffer[]
): Map<string, { freeQty: number; offerName: string }> {
  const remainingByProduct = new Map<string, number>();
  const offerNameByProduct = new Map<string, string>();
  for (const a of applied) {
    for (const u of a.free_units || []) {
      const id = String(u.productId || "");
      const q = Math.max(0, Math.floor(Number(u.qty) || 0));
      if (!id || q <= 0) continue;
      remainingByProduct.set(id, (remainingByProduct.get(id) || 0) + q);
      if (!offerNameByProduct.has(id)) offerNameByProduct.set(id, a.name);
    }
  }

  const out = new Map<string, { freeQty: number; offerName: string }>();
  for (const line of cart) {
    const pid = String(line.productId || "");
    const need = remainingByProduct.get(pid) || 0;
    if (need <= 0) continue;
    const take = Math.min(Math.max(0, Math.floor(line.quantity) || 0), need);
    if (take <= 0) continue;
    out.set(line.id, {
      freeQty: take,
      offerName: offerNameByProduct.get(pid) || "Promo",
    });
    remainingByProduct.set(pid, need - take);
  }
  return out;
}

export function isOfferInPeriod(
  rule: { valid_from?: string | null; valid_until?: string | null },
  todayIsoDate: string
): boolean {
  const from = rule.valid_from || null;
  const until = rule.valid_until || null;
  if (from && todayIsoDate < from) return false;
  if (until && todayIsoDate > until) return false;
  return true;
}
