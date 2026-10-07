export type SplitCalcLine = {
  id: string;
  name: string;
  productId: string;
  price: number;
  quantity: number;
};

export type SplitCalcRow = {
  label: string;
  total: number;
  subtotal: number;
  tax: number;
  discount: number;
};

export function guestLabel(index: number): string {
  return `Guest ${index + 1}`;
}

export function resolveGuestLabel(labels: string[], index: number): string {
  const custom = labels[index]?.trim();
  return custom || guestLabel(index);
}

export function buildEqualSplits(input: {
  count: number;
  total: number;
  taxAmount: number;
  discountAmount: number;
  labels: string[];
}): SplitCalcRow[] {
  const { count, total, taxAmount, discountAmount, labels } = input;
  if (count <= 0) return [];

  const base = Math.floor(total / count);
  const remainder = total - base * count;

  return Array.from({ length: count }, (_, i) => {
    const isLast = i === count - 1;
    const splitTotal = isLast ? base + remainder : base;
    return {
      label: resolveGuestLabel(labels, i),
      total: splitTotal,
      subtotal: 0,
      tax: Math.round(taxAmount / count),
      discount: Math.round(discountAmount / count),
    };
  });
}

export function buildPerItemSplits(input: {
  count: number;
  cartItems: SplitCalcLine[];
  assignments: Record<string, number[]>;
  taxAmount: number;
  discountAmount: number;
  labels: string[];
}): SplitCalcRow[] {
  const { count, cartItems, assignments, taxAmount, discountAmount, labels } =
    input;

  const rawSubtotals = Array.from({ length: count }, (_, splitIdx) => {
    let s = 0;
    for (const item of cartItems) {
      const qty = assignments[item.id]?.[splitIdx] || 0;
      s += qty * item.price;
    }
    return s;
  });

  const rawTotalSubtotal = rawSubtotals.reduce((a, b) => a + b, 0);

  const rows = Array.from({ length: count }, (_, i) => {
    const ratio = rawTotalSubtotal > 0 ? rawSubtotals[i] / rawTotalSubtotal : 0;
    const splitTax =
      i === count - 1
        ? 0
        : Math.round(taxAmount * ratio);
    const splitDisc =
      i === count - 1
        ? 0
        : Math.round(discountAmount * ratio);
    return {
      label: resolveGuestLabel(labels, i),
      subtotal: rawSubtotals[i],
      tax: splitTax,
      discount: splitDisc,
      total: 0,
    };
  });

  if (count > 0) {
    const taxAssigned = rows.slice(0, -1).reduce((sum, row) => sum + row.tax, 0);
    const discAssigned = rows
      .slice(0, -1)
      .reduce((sum, row) => sum + row.discount, 0);
    rows[count - 1].tax = taxAmount - taxAssigned;
    rows[count - 1].discount = discountAmount - discAssigned;
  }

  return rows.map((row) => ({
    ...row,
    total: row.subtotal + row.tax - row.discount,
  }));
}

export function countUnassignedQty(
  cartItems: Array<{ id: string; quantity: number }>,
  assignments: Record<string, number[]>
): number {
  let unassigned = 0;
  for (const item of cartItems) {
    const assigned = (assignments[item.id] || []).reduce((a, b) => a + b, 0);
    unassigned += Math.max(0, item.quantity - assigned);
  }
  return unassigned;
}

/**
 * Sesuaikan pembagian qty per item ke jumlah tamu: potong/isi nol sampai
 * `count`, dan item yang belum dibagi sama sekali jatuh ke tamu pertama.
 */
export function normalizeAssignments(
  prev: Record<string, number[]>,
  cartItems: Array<{ id: string; quantity: number }>,
  count: number
): Record<string, number[]> {
  const next: Record<string, number[]> = {};
  for (const item of cartItems) {
    const arr = [...(prev[item.id] || [])];
    while (arr.length < count) arr.push(0);
    while (arr.length > count) arr.pop();
    if (arr.reduce((a, b) => a + b, 0) === 0) arr[0] = item.quantity;
    next[item.id] = arr;
  }
  return next;
}

/** Label tamu sepanjang `count` (label kosong = "Guest N" saat ditampilkan). */
export function resizeLabels(labels: string[], count: number): string[] {
  const next = labels.slice(0, count);
  while (next.length < count) next.push("");
  return next;
}
