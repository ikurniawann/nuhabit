// EPIC-032 — evaluator promo murni (tanpa DB, pola pricing/capacity):
// pemanggil menyuplai aturan campaign + keadaan kode + konteks pemakaian
// (hitungan hidup dari SQL), fungsi ini memutuskan lolos/tolak + besar
// diskon. Keputusan owner 26 Jul: diskon PER TRANSAKSI, 1 kode per
// transaksi (stacking = Fase E).

export type PromoScope =
  | "ticketing_online"
  | "ticketing_loket"
  | "pos"
  | "semua";

export type PromoDiscountType = "percent" | "fixed";

/**
 * Kelayakan pemakai kode. `member_baru` = member yang BELUM pernah punya
 * order lunas (transaksi ini yang pertama); bila `new_member_days` diisi,
 * member juga harus terdaftar paling lama N hari. Dua syarat sekaligus
 * (AND) supaya member lama yang belum pernah belanja tidak ikut lolos saat
 * admin memang membatasi "pendaftar baru".
 */
export type PromoEligibility = "semua" | "member" | "member_baru";

/** Aturan campaign (baris promo_campaigns yang relevan utk evaluasi). */
export interface PromoCampaignRule {
  discount_type: PromoDiscountType;
  value: number;
  /** Cap rupiah utk percent; null = tanpa cap. Diabaikan utk fixed. */
  max_discount: number | null;
  min_purchase: number;
  valid_from: string | null; // YYYY-MM-DD inklusif
  valid_until: string | null;
  /** Batas total pemakaian lintas kode; null = tanpa batas. */
  usage_limit: number | null;
  /** Batas pemakaian per nomor WA; null = bebas. */
  per_phone_limit: number | null;
  scope: PromoScope;
  is_active: boolean;
  /** Kosong/undefined = semua produk. Diskon hanya dari baris yang cocok. */
  target_product_ids?: string[];
  target_category_ids?: string[];
  eligibility?: PromoEligibility;
  new_member_days?: number | null;
}

/** Satu baris keranjang (nilai bersih setelah diskon baris). */
export interface PromoLine {
  productId: string;
  categoryId: string | null;
  amount: number;
}

/** Riwayat member pemesan; null = transaksi tanpa member. */
export interface PromoMemberContext {
  /** Order lunas sebelum transaksi ini (void/batal tidak dihitung). */
  priorPaidOrders: number;
  /** Umur keanggotaan dalam hari (dibulatkan ke bawah). */
  joinedDaysAgo: number;
}

/** Keadaan kode (baris promo_codes). */
export interface PromoCodeState {
  is_active: boolean;
  /** null = ikut limit campaign; 1 = voucher sekali pakai. */
  usage_limit: number | null;
  usage_count: number;
}

/** Konteks pemakaian — hitungan hidup disuplai pemanggil (SQL). */
export interface PromoUsageContext {
  today: string; // YYYY-MM-DD WIB
  channel: Exclude<PromoScope, "semua">;
  subtotal: number;
  /** Redemption hidup (held/captured) lintas semua kode campaign. */
  campaignUsedCount: number;
  /** Redemption hidup campaign ini utk nomor WA pemesan. */
  phoneUsedCount: number;
  /** Wajib bila campaign membatasi produk/kategori (kasir POS). */
  lines?: PromoLine[];
  member?: PromoMemberContext | null;
}

export type PromoRejectReason =
  | "nonaktif"
  | "belum-mulai"
  | "kedaluwarsa"
  | "scope"
  | "khusus-member"
  | "bukan-member-baru"
  | "produk-tidak-sesuai"
  | "min-pembelian"
  | "kuota-habis"
  | "limit-nomor";

export type PromoEvalResult =
  | { ok: true; discount: number }
  | { ok: false; reason: PromoRejectReason };

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Besar diskon utk satu subtotal: percent dibulatkan 2dp lalu kena cap
 * `max_discount`; fixed apa adanya. Keduanya tak pernah melebihi subtotal
 * (total transaksi tidak boleh negatif).
 */
export function computeDiscount(
  campaign: Pick<PromoCampaignRule, "discount_type" | "value" | "max_discount">,
  subtotal: number
): number {
  let discount =
    campaign.discount_type === "percent"
      ? round2((subtotal * campaign.value) / 100)
      : campaign.value;
  if (campaign.discount_type === "percent" && campaign.max_discount !== null) {
    discount = Math.min(discount, campaign.max_discount);
  }
  return Math.min(discount, subtotal);
}

export function hasPromoTargets(
  campaign: Pick<PromoCampaignRule, "target_product_ids" | "target_category_ids">
): boolean {
  return (
    (campaign.target_product_ids?.length ?? 0) > 0 ||
    (campaign.target_category_ids?.length ?? 0) > 0
  );
}

/**
 * Basis diskon: tanpa target = seluruh subtotal; dengan target = jumlah
 * baris yang produknya ATAU kategorinya masuk daftar.
 */
export function promoEligibleSubtotal(
  campaign: Pick<PromoCampaignRule, "target_product_ids" | "target_category_ids">,
  subtotal: number,
  lines: PromoLine[] | undefined
): number {
  if (!hasPromoTargets(campaign)) return subtotal;
  const products = new Set(campaign.target_product_ids ?? []);
  const categories = new Set(campaign.target_category_ids ?? []);
  let base = 0;
  for (const line of lines ?? []) {
    const match =
      products.has(line.productId) ||
      (line.categoryId !== null && categories.has(line.categoryId));
    if (match) base += Math.max(0, line.amount);
  }
  return Math.round(base * 100) / 100;
}

function eligibilityReject(
  campaign: PromoCampaignRule,
  member: PromoMemberContext | null | undefined
): PromoRejectReason | null {
  const eligibility = campaign.eligibility ?? "semua";
  if (eligibility === "semua") return null;
  if (!member) return "khusus-member";
  if (eligibility === "member_baru") {
    if (member.priorPaidOrders > 0) return "bukan-member-baru";
    if (
      campaign.new_member_days != null &&
      member.joinedDaysAgo > campaign.new_member_days
    ) {
      return "bukan-member-baru";
    }
  }
  return null;
}

/**
 * Evaluasi lengkap satu kode utk satu transaksi. Urutan cek deterministik
 * (aktif → window → scope → kelayakan member → produk → min pembelian →
 * kuota → limit nomor) supaya pesan penolakan stabil & mudah diuji.
 */
export function evaluatePromo(
  campaign: PromoCampaignRule,
  code: PromoCodeState,
  ctx: PromoUsageContext
): PromoEvalResult {
  if (!campaign.is_active || !code.is_active) {
    return { ok: false, reason: "nonaktif" };
  }
  if (campaign.valid_from !== null && ctx.today < campaign.valid_from) {
    return { ok: false, reason: "belum-mulai" };
  }
  if (campaign.valid_until !== null && ctx.today > campaign.valid_until) {
    return { ok: false, reason: "kedaluwarsa" };
  }
  if (campaign.scope !== "semua" && campaign.scope !== ctx.channel) {
    return { ok: false, reason: "scope" };
  }
  const memberReject = eligibilityReject(campaign, ctx.member);
  if (memberReject) return { ok: false, reason: memberReject };
  const base = promoEligibleSubtotal(campaign, ctx.subtotal, ctx.lines);
  if (hasPromoTargets(campaign) && base <= 0) {
    return { ok: false, reason: "produk-tidak-sesuai" };
  }
  // Subtotal 0 tidak pernah layak didiskon (dan lolosnya membingungkan)
  if (ctx.subtotal <= 0 || ctx.subtotal < campaign.min_purchase) {
    return { ok: false, reason: "min-pembelian" };
  }
  // Kuota: limit KODE lebih spesifik — bila terisi, dialah yang berlaku;
  // tanpa limit kode, jatuh ke limit campaign (lintas semua kodenya)
  if (code.usage_limit !== null) {
    if (code.usage_count >= code.usage_limit) {
      return { ok: false, reason: "kuota-habis" };
    }
  } else if (
    campaign.usage_limit !== null &&
    ctx.campaignUsedCount >= campaign.usage_limit
  ) {
    return { ok: false, reason: "kuota-habis" };
  }
  if (
    campaign.per_phone_limit !== null &&
    ctx.phoneUsedCount >= campaign.per_phone_limit
  ) {
    return { ok: false, reason: "limit-nomor" };
  }
  return { ok: true, discount: computeDiscount(campaign, base) };
}

/** Pesan penolakan ramah pengunjung (dipakai endpoint publik & wizard). */
export const PROMO_REJECT_MESSAGES: Record<PromoRejectReason, string> = {
  nonaktif: "Kode promo tidak dikenal atau sudah tidak berlaku",
  "belum-mulai": "Kode promo belum mulai berlaku",
  kedaluwarsa: "Kode promo sudah berakhir",
  scope: "Kode promo tidak berlaku untuk pembelian ini",
  "khusus-member": "Kode ini khusus member — pilih member dulu",
  "bukan-member-baru":
    "Kode ini khusus member baru (transaksi pertama) — member ini tidak memenuhi syarat",
  "produk-tidak-sesuai":
    "Kode ini hanya untuk produk/kategori tertentu — belum ada di keranjang",
  "min-pembelian": "Belanja belum mencapai minimum untuk kode ini",
  "kuota-habis": "Kuota kode promo sudah habis",
  "limit-nomor": "Nomor ini sudah memakai kode promo ini",
};

/** Label pendek utk badge penolakan di kasir. */
export const PROMO_REJECT_LABELS: Record<PromoRejectReason, string> = {
  nonaktif: "Tidak berlaku",
  "belum-mulai": "Belum mulai",
  kedaluwarsa: "Kedaluwarsa",
  scope: "Beda kanal",
  "khusus-member": "Khusus member",
  "bukan-member-baru": "Khusus member baru",
  "produk-tidak-sesuai": "Produk tidak sesuai",
  "min-pembelian": "Belum capai minimum",
  "kuota-habis": "Kuota habis",
  "limit-nomor": "Sudah dipakai",
};
