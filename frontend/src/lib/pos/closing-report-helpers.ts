export type SalesSegmentCode = "FNB" | "BEV" | "OTHER";

export const STATION_SEGMENT: Record<string, SalesSegmentCode> = {
  kitchen: "FNB",
  bakery: "FNB",
  dessert: "FNB",
  bar: "BEV",
  merchandise: "BEV",
  photobooth: "OTHER",
};

export const SEGMENT_LABELS: Record<SalesSegmentCode, string> = {
  FNB: "F&B",
  BEV: "Beverage",
  OTHER: "Others",
};

export function toNumber(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

export function roundCurrency(value: number) {
  return Math.round(value * 100) / 100;
}

export function percentage(part: number, total: number) {
  if (total <= 0) return 0;
  return Math.round((part / total) * 1000) / 10;
}

export function formatReportDate(value: string | Date) {
  const date = typeof value === "string" ? new Date(`${value}T12:00:00`) : value;
  const weekday = new Intl.DateTimeFormat("en-US", { weekday: "long" }).format(date);
  const day = date.getDate();
  const suffix =
    day % 10 === 1 && day !== 11
      ? "st"
      : day % 10 === 2 && day !== 12
        ? "nd"
        : day % 10 === 3 && day !== 13
          ? "rd"
          : "th";
  const month = new Intl.DateTimeFormat("en-US", { month: "short" }).format(date);
  const year = date.getFullYear();
  return `${weekday}, ${String(day).padStart(2, "0")}${suffix} ${month} ${year}`;
}

export function formatReportTime(value?: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Jakarta",
  }).format(new Date(value));
}

export function resolveSegment(station?: string | null): SalesSegmentCode {
  if (!station) return "OTHER";
  return STATION_SEGMENT[station] || "OTHER";
}

export function targetBlock(actual: number, target: number) {
  return {
    target: roundCurrency(target),
    actual: roundCurrency(actual),
    variance: roundCurrency(actual - target),
  };
}

/** Diskon penuh: potongan menutup subtotal, atau bill lunas jadi 0. */
export function isFullDiscountOrder(order: {
  subtotal?: number | string | null;
  discount_amount?: number | string | null;
  total_amount?: number | string | null;
}): boolean {
  const subtotal = toNumber(order.subtotal);
  const discount = toNumber(order.discount_amount);
  const total = toNumber(order.total_amount);
  if (subtotal <= 0) return false;
  if (discount + 0.01 >= subtotal) return true;
  return total <= 0.01 && discount > 0;
}

export function summarizeClosingTransactions(
  orders: Array<{
    subtotal?: number | string | null;
    discount_amount?: number | string | null;
    total_amount?: number | string | null;
  }>
) {
  let transactions = 0;
  let sales = 0;
  let discount = 0;
  let fullDiscountTransactions = 0;
  let fullDiscountAmount = 0;

  for (const order of orders) {
    transactions += 1;
    const subtotal = toNumber(order.subtotal);
    const orderDiscount = toNumber(order.discount_amount);
    sales += toNumber(order.total_amount);
    discount += orderDiscount;
    if (isFullDiscountOrder(order)) {
      fullDiscountTransactions += 1;
      fullDiscountAmount += subtotal;
    }
  }

  return {
    transactions,
    sales: roundCurrency(sales),
    discount: roundCurrency(discount),
    full_discount_transactions: fullDiscountTransactions,
    full_discount_amount: roundCurrency(fullDiscountAmount),
  };
}
