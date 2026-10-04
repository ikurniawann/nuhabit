import { formatRupiah } from "@/lib/format";
export type DiscountType = "percent" | "fixed";

export type ManualDiscountInput = {
  discount_type?: DiscountType | null;
  discount_value?: number | null;
};

export type LineDiscountInput = ManualDiscountInput & {
  line_subtotal: number;
};

export type OrderDiscountStackInput = {
  items: LineDiscountInput[];
  /** Product offer rules (bundle/bxgy/volume) after line discounts */
  offer_discount?: number | null;
  membership_pct?: number | null;
  /** Raw promo engine discount before membership/manual caps */
  promo_discount?: number | null;
  manual_discount_type?: DiscountType | null;
  manual_discount_value?: number | null;
};

export type LineDiscountResult = {
  discount_amount: number;
  total_amount: number;
};

export type OrderDiscountStack = {
  gross_subtotal: number;
  line_discount_total: number;
  items_subtotal: number;
  offer_amount: number;
  membership_amount: number;
  promo_amount: number;
  manual_amount: number;
  discount_amount: number;
  after_discount: number;
  line_results: LineDiscountResult[];
};

/** Potongan dari basis; percent di-floor; selalu di-cap ke basis. */
export function computeDiscountAmount(
  basis: number,
  type: DiscountType | null | undefined,
  value: number | null | undefined
): number {
  const safeBasis = Math.max(0, Number(basis) || 0);
  const safeValue = Number(value);
  if (!type || !Number.isFinite(safeValue) || safeValue <= 0 || safeBasis <= 0) {
    return 0;
  }

  let amount = 0;
  if (type === "percent") {
    const pct = Math.min(100, safeValue);
    amount = Math.floor((safeBasis * pct) / 100);
  } else {
    amount = Math.floor(safeValue);
  }

  return Math.min(Math.max(0, amount), safeBasis);
}

export function computeLineDiscount(input: LineDiscountInput): LineDiscountResult {
  const line_subtotal = Math.max(0, Number(input.line_subtotal) || 0);
  const discount_amount = computeDiscountAmount(
    line_subtotal,
    input.discount_type,
    input.discount_value
  );
  return {
    discount_amount,
    total_amount: line_subtotal - discount_amount,
  };
}

/**
 * Stack: item → offer → membership → promo → manual transaksi.
 * `gross_subtotal` = Σ line_subtotal; order.discount_amount = agregat semua potongan.
 */
export function computeOrderDiscountStack(
  input: OrderDiscountStackInput
): OrderDiscountStack {
  const line_results: LineDiscountResult[] = [];
  let gross_subtotal = 0;
  let line_discount_total = 0;
  let items_subtotal = 0;

  for (const item of input.items) {
    const line = computeLineDiscount(item);
    line_results.push(line);
    gross_subtotal += Math.max(0, Number(item.line_subtotal) || 0);
    line_discount_total += line.discount_amount;
    items_subtotal += line.total_amount;
  }

  const offerRaw = Math.max(0, Number(input.offer_discount) || 0);
  const offer_amount = Math.min(offerRaw, items_subtotal);

  const afterOffer = Math.max(0, items_subtotal - offer_amount);

  const membership_pct = Math.max(0, Number(input.membership_pct) || 0);
  const membership_amount =
    membership_pct > 0 ? Math.floor((afterOffer * membership_pct) / 100) : 0;

  const promoRaw = Math.max(0, Number(input.promo_discount) || 0);
  const promo_amount = Math.min(
    promoRaw,
    Math.max(0, afterOffer - membership_amount)
  );

  const manual_basis = Math.max(
    0,
    afterOffer - membership_amount - promo_amount
  );
  const manual_amount = computeDiscountAmount(
    manual_basis,
    input.manual_discount_type,
    input.manual_discount_value
  );

  const discount_amount =
    line_discount_total +
    offer_amount +
    membership_amount +
    promo_amount +
    manual_amount;
  const after_discount = Math.max(
    0,
    afterOffer - membership_amount - promo_amount - manual_amount
  );

  return {
    gross_subtotal,
    line_discount_total,
    items_subtotal,
    offer_amount,
    membership_amount,
    promo_amount,
    manual_amount,
    discount_amount,
    after_discount,
    line_results,
  };
}

export function buildDiscountReason(input: {
  has_item_discounts: boolean;
  offer_labels?: string[] | null;
  membership_pct?: number | null;
  promo_code?: string | null;
  manual_type?: DiscountType | null;
  manual_value?: number | null;
}): string | null {
  const parts: string[] = [];
  if (input.has_item_discounts) parts.push("ITEM line discounts");
  for (const label of input.offer_labels || []) {
    const t = String(label || "").trim();
    if (t) parts.push(`OFFER ${t}`);
  }
  const mem = Number(input.membership_pct) || 0;
  if (mem > 0) parts.push(`MEMBER ${mem}%`);
  const code = String(input.promo_code || "").trim();
  if (code) parts.push(`PROMO ${code.toUpperCase()}`);
  if (input.manual_type && Number(input.manual_value) > 0) {
    parts.push(
      input.manual_type === "percent"
        ? `MANUAL ${Number(input.manual_value)}%`
        : `MANUAL Rp ${Math.floor(Number(input.manual_value))}`
    );
  }
  return parts.length > 0 ? parts.join("; ") : null;
}

export function formatDiscountLabel(
  type: DiscountType | null | undefined,
  value: number | null | undefined
): string | null {
  if (!type || value == null || Number(value) <= 0) return null;
  if (type === "percent") return `−${Number(value)}%`;
  const n = Math.floor(Number(value));
  return `−${formatRupiah(n)}`;
}

export type ParsedDiscountReason = {
  hasItem: boolean;
  memberPct: number | null;
  promoCode: string | null;
  manualLabel: string | null;
};

export function parseDiscountReason(
  reason?: string | null
): ParsedDiscountReason {
  const raw = String(reason || "").trim();
  if (!raw) {
    return {
      hasItem: false,
      memberPct: null,
      promoCode: null,
      manualLabel: null,
    };
  }
  const parts = raw
    .split(";")
    .map((p) => p.trim())
    .filter(Boolean);
  let hasItem = false;
  let memberPct: number | null = null;
  let promoCode: string | null = null;
  let manualLabel: string | null = null;
  for (const part of parts) {
    if (/^ITEM\b/i.test(part)) hasItem = true;
    const member = part.match(/^MEMBER\s+(\d+(?:\.\d+)?)\s*%$/i);
    if (member) memberPct = Number(member[1]);
    const promo = part.match(/^PROMO\s+(.+)$/i);
    if (promo) promoCode = promo[1].trim().toUpperCase();
    const manual = part.match(/^MANUAL\s+(.+)$/i);
    if (manual) manualLabel = manual[1].trim();
  }
  return { hasItem, memberPct, promoCode, manualLabel };
}

export type OrderDiscountBreakdown = {
  item_amount: number;
  membership_amount: number;
  promo_amount: number;
  manual_amount: number;
  total: number;
  promo_code: string | null;
  member_pct: number | null;
  manual_label: string | null;
};

/**
 * Rekonstruksi nominal stack dari order tersimpan (subtotal bruto + line
 * discount + reason + manual fields). Dipakai UI detail — bukan sumber
 * kebenaran accounting (itu tetap order.discount_amount).
 */
export function reconstructOrderDiscountBreakdown(input: {
  subtotal?: number | null;
  discount_amount?: number | null;
  discount_reason?: string | null;
  manual_discount_type?: DiscountType | null;
  manual_discount_value?: number | null;
  items?: Array<{ discount_amount?: number | null }> | null;
}): OrderDiscountBreakdown {
  const parsed = parseDiscountReason(input.discount_reason);
  const total = Math.max(0, Math.round(Number(input.discount_amount) || 0));
  const gross = Math.max(0, Number(input.subtotal) || 0);
  const item_amount = Math.max(
    0,
    (input.items || []).reduce(
      (sum, item) => sum + Math.max(0, Number(item.discount_amount) || 0),
      0
    )
  );
  const itemsSubtotal = Math.max(0, gross - item_amount);
  const member_pct = parsed.memberPct;
  const membership_amount =
    member_pct != null && member_pct > 0
      ? Math.floor((itemsSubtotal * member_pct) / 100)
      : 0;

  const afterMember = Math.max(0, itemsSubtotal - membership_amount);
  const leftover = Math.max(0, total - item_amount - membership_amount);

  let promo_amount = 0;
  let manual_amount = 0;
  const hasPromo = Boolean(parsed.promoCode);
  const hasManualFields =
    input.manual_discount_type != null &&
    Number(input.manual_discount_value) > 0;
  const hasManual = hasManualFields || Boolean(parsed.manualLabel);

  if (hasPromo && hasManualFields && input.manual_discount_type) {
    let found = false;
    const type = input.manual_discount_type;
    const value = input.manual_discount_value;
    // Cari P di [0..leftover] agar P + manual(afterMember-P) = leftover
    for (let promo = 0; promo <= leftover; promo += 1) {
      const manual = computeDiscountAmount(afterMember - promo, type, value);
      if (promo + manual === leftover) {
        promo_amount = promo;
        manual_amount = manual;
        found = true;
        break;
      }
    }
    if (!found) {
      promo_amount = leftover;
      manual_amount = 0;
    }
  } else if (hasPromo) {
    promo_amount = leftover;
  } else if (hasManual) {
    manual_amount = leftover;
  }

  // Jika reason bilang ada promo tapi nominal belum ketemu, alokasikan sisa.
  if (hasPromo && promo_amount <= 0) {
    const allocated =
      item_amount + membership_amount + manual_amount;
    promo_amount = Math.max(0, total - allocated);
  }

  const sumParts =
    item_amount + membership_amount + promo_amount + manual_amount;
  const drift = total - sumParts;
  if (drift !== 0) {
    if (hasPromo || promo_amount > 0)
      promo_amount = Math.max(0, promo_amount + drift);
    else if (hasManual || manual_amount > 0)
      manual_amount = Math.max(0, manual_amount + drift);
    else if (drift > 0) promo_amount = drift;
  }

  const manual_label =
    formatDiscountLabel(
      input.manual_discount_type,
      input.manual_discount_value
    ) || (parsed.manualLabel ? `−${parsed.manualLabel}` : null);

  return {
    item_amount,
    membership_amount,
    promo_amount,
    manual_amount,
    total,
    promo_code: parsed.promoCode,
    member_pct,
    manual_label,
  };
}

export function isValidDiscountInput(
  type: DiscountType,
  value: number,
  basis: number
): { ok: true } | { ok: false; error: string } {
  if (!Number.isFinite(value) || value <= 0) {
    return { ok: false, error: "Nilai diskon harus lebih dari 0" };
  }
  if (type === "percent" && value > 100) {
    return { ok: false, error: "Persen maksimal 100%" };
  }
  if (basis <= 0) {
    return { ok: false, error: "Tidak ada basis untuk diskon" };
  }
  if (type === "fixed" && value > basis) {
    return { ok: false, error: "Nominal melebihi nilai yang boleh dipotong" };
  }
  return { ok: true };
}
