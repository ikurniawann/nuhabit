/**
 * Label pelanggan sebuah order untuk layar kasir/laporan/struk. Urutan:
 * member (pos_customers) → kontak pemesan self-order (contact_name/phone,
 * wajib sejak 2026-09-28) → "Walk-in".
 */

type OrderLike = {
  customer?: { name?: string | null; phone?: string | null } | null;
  contact_name?: string | null;
  contact_phone?: string | null;
};

/** 628xx → 08xx (tampilan lokal). */
export function localPhone(phone: string | null | undefined): string | null {
  const value = String(phone || "").trim();
  if (!value) return null;
  return value.startsWith("62") ? `0${value.slice(2)}` : value;
}

export function orderCustomerName(order: OrderLike | null | undefined): string | null {
  return order?.customer?.name?.trim() || order?.contact_name?.trim() || null;
}

export function orderCustomerPhone(order: OrderLike | null | undefined): string | null {
  return localPhone(order?.customer?.phone) || localPhone(order?.contact_phone);
}

export function orderCustomerLabel(order: OrderLike | null | undefined, options: { withPhone?: boolean } = {}): string {
  const name = orderCustomerName(order);
  const phone = options.withPhone ? orderCustomerPhone(order) : null;
  if (name && phone) return `${name} · ${phone}`;
  return name || phone || "Walk-in";
}
