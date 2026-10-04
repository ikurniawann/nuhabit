/** Label tampilan halaman Tagihan Member (Rupiah & tanggal: @/lib/format). */

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
