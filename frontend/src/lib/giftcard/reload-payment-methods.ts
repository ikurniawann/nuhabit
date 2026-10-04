// Tanpa import Node — aman dipakai komponen klien (dialog reload).

/** Metode bayar reload: uang masuk nyata, bukan saldo titipan lain. */
export const GIFT_CARD_RELOAD_PAYMENT_METHODS = {
  cash: "Tunai",
  qris: "QRIS",
  debit_card: "Kartu Debit",
  credit_card: "Kartu Kredit",
  transfer: "Transfer Bank",
} as const;

export type GiftCardReloadPaymentMethod = keyof typeof GIFT_CARD_RELOAD_PAYMENT_METHODS;
