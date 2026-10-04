import { isValidNfcUid, normalizeNfcUid } from '@/lib/ticketing/server';

export type GuardRejection = { ok: false; status: number; error: string };
export type GuardResult = { ok: true } | GuardRejection;

const OK: GuardResult = { ok: true };

function reject(status: number, error: string): GuardRejection {
  return { ok: false, status, error };
}

/**
 * Guard pembayaran saldo (NFC Tab, gift card) dan penjualan gift card.
 * Rate limit per metode dicek service SEBELUM fungsi ini (NFC Tab dan gift
 * card saling eksklusif, jadi urutannya tetap sama dgn alur lama).
 */
export function guardBalancePayment(input: {
  paymentMethod: string;
  nfcTabUid: string;
  giftCardCode: string;
  arkUsed: number;
  venue: { companyId: string | null; branchId: string | null };
  sellsGiftCard: boolean;
}): GuardResult {
  const isNfcTab = input.paymentMethod === 'nfc_tab';
  const payWithGiftCard = input.paymentMethod === 'gift_card';

  if (isNfcTab) {
    if (!input.nfcTabUid) return reject(400, 'Pembayaran NFC Tab membutuhkan tap gelang');
    if (!isValidNfcUid(normalizeNfcUid(input.nfcTabUid))) {
      return reject(400, 'UID gelang tidak valid — tap ulang gelang');
    }
    if (input.arkUsed > 0) {
      return reject(400, 'NFC Tab tidak bisa dicampur ARK Coin — 1 transaksi 1 metode');
    }
  }

  // EPIC-034 Fase C — guard pembayaran gift card
  if (payWithGiftCard) {
    if (!input.giftCardCode) return reject(400, 'Pembayaran gift card membutuhkan kode kartu');
    if (input.arkUsed > 0) {
      return reject(400, 'Gift card tidak bisa dicampur ARK Coin — 1 transaksi 1 metode');
    }
    if (!input.venue.companyId || !input.venue.branchId) {
      return reject(400, 'Venue belum dikonfigurasi — gift card tidak bisa dipakai');
    }
  }

  // Saldo titipan/loyalitas tidak boleh dipakai MEMBELI saldo titipan baru
  // (gift card beli gift card = uang berputar tanpa kas masuk).
  if (input.sellsGiftCard && (payWithGiftCard || isNfcTab || input.paymentMethod === 'ark_coin')) {
    return reject(400, 'Gift card harus dibeli dengan pembayaran tunai/kartu/QRIS, bukan saldo');
  }
  return OK;
}

/**
 * Metode FOC (keputusan owner 2026-08-24): WAJIB ber-customer/member dan PIN
 * supervisor. Verifikasi PIN (DB) dilakukan service setelah guard ini lolos.
 */
export function guardFocRequest(input: {
  customerId: string | undefined;
  supervisorPin: string;
}): GuardResult {
  if (!input.customerId) {
    return reject(400, 'Metode FOC membutuhkan customer/member — pilih customer dulu');
  }
  if (!input.supervisorPin) return reject(400, 'Metode FOC membutuhkan PIN supervisor');
  return OK;
}

/**
 * Kecukupan bayar + aturan ARK Coin. 1 pembayaran = 1 metode (EPIC-011): ARK
 * Coin tidak boleh dicampur metode lain, dan pembayaran ARK Coin harus
 * menutup seluruh total. NFC Tab, gift card, dan FOC tidak menerima uang di
 * sini, jadi tidak dicek kecukupannya.
 */
export function guardSettlement(input: {
  paymentMethod: string;
  focApproved: boolean;
  paidAmount: number;
  arkUsed: number;
  total: number;
  customerId: string | undefined;
}): GuardResult {
  const balanceSettled =
    input.paymentMethod === 'nfc_tab' || input.paymentMethod === 'gift_card' || input.focApproved;
  if (!balanceSettled && input.paidAmount + input.arkUsed < input.total) {
    return reject(400, 'Payment insufficient');
  }
  if (input.arkUsed > 0 && input.paymentMethod !== 'ark_coin') {
    return reject(
      400,
      'ARK Coin tidak bisa dicampur metode lain — 1 transaksi 1 metode pembayaran'
    );
  }
  if (input.paymentMethod === 'ark_coin') {
    if (!input.customerId) return reject(400, 'Pembayaran ARK Coin membutuhkan customer');
    if (input.arkUsed < input.total) {
      return reject(400, 'Pembayaran ARK Coin harus menutup seluruh total order');
    }
  }
  return OK;
}

/**
 * EPIC-043: komplimen KOL — customer wajib ada dan diskonnya menggratiskan
 * SELURUH order. owner_comp tidak lewat sini, hanya via pelunasan open bill.
 * Status KOL + kuota bulanan divalidasi service (DB) setelah guard ini.
 */
export function guardCompRequest(input: {
  compType: unknown;
  customerId: string | undefined;
  total: number;
}): { ok: true; compType: 'kol_comp' | null } | GuardRejection {
  if (input.compType == null || String(input.compType) === '') return { ok: true, compType: null };
  if (String(input.compType) !== 'kol_comp') {
    return reject(
      400,
      'comp_type tidak dikenal utk pembuatan order (owner_comp hanya via pelunasan open bill)'
    );
  }
  if (!input.customerId) return reject(400, 'Komplimen KOL membutuhkan customer');
  if (input.total > 0.5) {
    return reject(400, 'Komplimen KOL harus menggratiskan seluruh order (total 0)');
  }
  return { ok: true, compType: 'kol_comp' };
}
