import type { CreditPackage } from "./api";

/**
 * Paket aktif yang boleh dijual di cabang: paket semua cabang plus paket khusus
 * cabang itu. Tanpa cabang ("") paket khusus cabang disembunyikan karena
 * server menolaknya.
 */
export function sellablePackages(packages: CreditPackage[], branchId: string): CreditPackage[] {
  return packages.filter((p) => p.status === "active" && (!p.branch_id || p.branch_id === branchId));
}

/** Harga paket di cabang: harga cabang bila diatur, selain itu harga dasar. */
export function priceAt(pkg: Pick<CreditPackage, "price_idr" | "branch_prices">, branchId: string): number {
  return pkg.branch_prices.find((bp) => bp.branch_id === branchId)?.price_idr ?? pkg.price_idr;
}

/**
 * Rincian penjualan di front desk: voucher dipotong dulu, diskon manual
 * dari sisanya. Komplimen menghapus seluruh harga. Total tidak pernah minus.
 */
export function saleTotal(price: number, voucherIdr: number, manualIdr: number, complimentary: boolean) {
  const voucher = complimentary ? 0 : Math.min(Math.max(0, voucherIdr), price);
  const manual = complimentary ? price : Math.min(Math.max(0, manualIdr), price - voucher);
  return { voucher, manual, total: price - voucher - manual };
}
