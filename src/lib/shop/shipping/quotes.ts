// Aturan tarif ongkir murni (tanpa I/O): markup toko & pencocokan pilihan kurir.

import type { RateQuote } from "./types";

export type PricedQuote = RateQuote & { total_price: number };

/** Buang tarif 0 (layanan tidak tersedia) lalu tambahkan markup flat toko. */
export function withMarkup(quotes: RateQuote[], markup: number): PricedQuote[] {
  return quotes
    .filter((quote) => quote.price > 0)
    .map((quote) => ({ ...quote, total_price: quote.price + markup }));
}

/** Tarif yang cocok dengan pilihan klien (kode kurir + layanan, abaikan huruf besar). */
export function findQuote(
  quotes: RateQuote[],
  courierCode: string,
  serviceCode: string
): RateQuote | undefined {
  const courier = courierCode.toLowerCase();
  const service = serviceCode.toLowerCase();
  return quotes.find(
    (quote) =>
      quote.courierCode.toLowerCase() === courier &&
      quote.serviceCode.toLowerCase() === service &&
      quote.price > 0
  );
}
