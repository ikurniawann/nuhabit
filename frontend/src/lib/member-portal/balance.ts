/**
 * Peringatan saldo rendah di kartu saldo portal. Ambang dalam Rupiah dari
 * pos_loyalty_settings.low_balance_threshold_idr; 0 = fitur mati. Saldo 0
 * tidak ikut diperingatkan: member yang belum pernah top-up tidak perlu
 * diberi tanda bahaya.
 */
export function isLowBalance(balanceIdr: number, thresholdIdr: number): boolean {
  return thresholdIdr > 0 && balanceIdr > 0 && balanceIdr < thresholdIdr;
}
