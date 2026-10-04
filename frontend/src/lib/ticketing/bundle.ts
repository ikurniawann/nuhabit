// Fase P — Ticket Bundling (Paket): helper murni komposisi & alokasi
// harga. Paket = ticket_product 'bundle' ber-satu varian "Paket"; saat
// dijual, 1 unit paket meledak jadi anggota per orang (varian KOMPONEN)
// dengan harga alokasi prorata dari harga paket. Tanpa DB agar mudah
// diuji — pemanggil menyuplai komposisi yang sudah ter-scope venue.

/** Satu baris komposisi paket (per 1 unit paket). */
export interface BundleComponentDef {
  component_variant_id: string;
  qty: number;
  product_name: string;
  variant_name: string;
  /**
   * Harga satuan varian komponen utk musim tanggal transaksi — bobot
   * prorata alokasi. Null = tidak diketahui → seluruh unit jatuh ke
   * pembagian rata.
   */
  weight_price: number | null;
}

/** Satu anggota (satu orang / satu gelang) hasil ekspansi 1 unit paket. */
export interface BundleMember {
  component_variant_id: string;
  member_label: string;
  weight_price: number | null;
}

/** Jumlah orang per 1 unit paket. */
export function bundleMembersPerUnit(
  components: readonly BundleComponentDef[]
): number {
  return components.reduce((sum, c) => sum + c.qty, 0);
}

/**
 * Ekspansi 1 unit paket menjadi daftar anggota terurut (urutan komposisi,
 * qty di-flatten) — urutan ini dipakai konsisten oleh loket, booking, dan
 * pemetaan nama anggota supaya posisi N selalu berarti orang yang sama.
 */
export function expandBundleMembers(
  components: readonly BundleComponentDef[]
): BundleMember[] {
  return components.flatMap((c) =>
    Array.from({ length: c.qty }, () => ({
      component_variant_id: c.component_variant_id,
      member_label: `${c.product_name} — ${c.variant_name}`,
      weight_price: c.weight_price,
    }))
  );
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Prorata harga paket ke tiap anggota berdasarkan bobot harga satuan
 * komponen. Pembulatan kumulatif 2dp: Σ hasil SELALU tepat = harga paket
 * (syarat net-0 redeem) dan tiap bagian ≥ 0. Bobot tak lengkap/nol →
 * pembagian rata.
 */
export function allocateBundlePrice(
  bundlePrice: number,
  weights: readonly (number | null)[]
): number[] {
  if (weights.length === 0) return [];
  const usable = weights.every(
    (w) => typeof w === "number" && Number.isFinite(w) && w >= 0
  );
  const totalWeight = usable
    ? (weights as readonly number[]).reduce((sum, w) => sum + w, 0)
    : 0;
  const effective =
    usable && totalWeight > 0
      ? (weights as readonly number[])
      : weights.map(() => 1);
  const effectiveTotal =
    usable && totalWeight > 0 ? totalWeight : weights.length;

  const total = round2(bundlePrice);
  const shares: number[] = [];
  let cumWeight = 0;
  let cumAllocated = 0;
  for (const weight of effective) {
    cumWeight += weight;
    const cumTarget = round2((total * cumWeight) / effectiveTotal);
    shares.push(round2(cumTarget - cumAllocated));
    cumAllocated = cumTarget;
  }
  return shares;
}
