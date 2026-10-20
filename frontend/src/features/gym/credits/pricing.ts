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
