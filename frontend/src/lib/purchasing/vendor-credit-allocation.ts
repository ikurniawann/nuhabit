/**
 * Pemakaian kredit vendor (port AllocateCredits, domain/payables.go NüHabit).
 *
 * Kredit tertua dipakai lebih dulu dan kredit kedaluwarsa tidak dipakai sama
 * sekali: memakai yang terbaru membiarkan yang lama hangus.
 */

export interface VendorCreditBalance {
  id: string;
  credit_number: string;
  /** YYYY-MM-DD */
  credit_date: string;
  total_amount: number;
  applied_amount: number;
  status: string;
  /** YYYY-MM-DD, null = tanpa batas. */
  expiry_date: string | null;
}

export interface CreditAllocation {
  credit_id: string;
  credit_number: string;
  amount: number;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Sisa kredit; nol bila kredit belum disetujui atau dibatalkan. */
export function creditRemaining(credit: VendorCreditBalance): number {
  if (credit.status !== "approved") return 0;
  return round2(Math.max(0, credit.total_amount - credit.applied_amount));
}

export function isCreditExpired(credit: Pick<VendorCreditBalance, "expiry_date">, today: string): boolean {
  return credit.expiry_date !== null && credit.expiry_date < today;
}

/**
 * Alokasikan `amount` ke kredit yang masih bisa dipakai. Mengembalikan alokasi
 * per kredit dan sisa yang tidak tertutup kredit.
 */
export function allocateCredits(
  credits: VendorCreditBalance[],
  amount: number,
  today: string
): { allocations: CreditAllocation[]; remaining: number } {
  let remaining = round2(amount);
  if (remaining <= 0) return { allocations: [], remaining: 0 };

  const usable = credits
    .filter((credit) => creditRemaining(credit) > 0 && !isCreditExpired(credit, today))
    .sort((a, b) => a.credit_date.localeCompare(b.credit_date));

  const allocations: CreditAllocation[] = [];
  for (const credit of usable) {
    if (remaining <= 0) break;
    const take = round2(Math.min(creditRemaining(credit), remaining));
    if (take <= 0) continue;
    allocations.push({ credit_id: credit.id, credit_number: credit.credit_number, amount: take });
    remaining = round2(remaining - take);
  }
  return { allocations, remaining };
}
