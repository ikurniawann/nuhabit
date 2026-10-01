/** Format tampilan halaman Tagihan (WIB, Rupiah). */

export function formatIdr(value: number) {
  return `Rp ${Math.round(Number(value) || 0).toLocaleString("id-ID")}`;
}

export function formatDateTimeWib(iso: string | null | undefined) {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("id-ID", {
    timeZone: "Asia/Jakarta",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** "hari ini" / "N hari" sejak order terlama — untuk daftar tagihan. */
export function ageText(iso: string | null | undefined, now = new Date()) {
  if (!iso) return null;
  const days = Math.floor((now.getTime() - new Date(iso).getTime()) / 86_400_000);
  if (!Number.isFinite(days) || days <= 0) return "sejak hari ini";
  return `sejak ${days} hari`;
}

const ORDER_TYPE_LABEL: Record<string, string> = {
  dine_in: "Dine-in",
  takeaway: "Takeaway",
  delivery: "Delivery",
};

export function orderTypeLabel(value: string | null | undefined) {
  return ORDER_TYPE_LABEL[String(value || "")] || "—";
}
