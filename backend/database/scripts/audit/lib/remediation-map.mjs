/**
 * Pemetaan tetap antara workbook dan struktur database.
 *
 * Dipisah dari logikanya supaya keputusan pemetaan (yang butuh penilaian manusia)
 * gampang ditinjau ulang tanpa membaca seluruh skrip.
 */

/** Sheet stall → kode warehouse di configuration.warehouses. */
export const SHEET_TO_WAREHOUSE = {
  "teppanyaki stall": "STALL-03",
  "dumpling stall": "STALL-04",
  "sushi - sashimi stall": "STALL-05",
  "bakery stall": "STALL-06",
  "burger - sandwiches stall": "STALL-07",
  "agemono - frying section stall": "STALL-08",
  "rice bowl stall": "STALL-09",
  "yakimono - grilled stall": "STALL-13",
  "yakitori stall": "STALL-02",
  "onigiri corner stall": "STALL-14",
  "yokoco beverage stall": "STALL-15",
  // "coffee matcha bar beverage" sengaja tidak dipetakan — warehouse-nya belum
  // ada dan dibuat saat remediasi (lihat NEW_WAREHOUSES).
};

/**
 * Sheet "Noodles - Udon - Japanese Porri" di workbook digabung, tapi di database
 * terpecah tiga. Dipilah dari nama menunya.
 */
export function noodlesWarehouse(menuName) {
  const name = String(menuName).toLowerCase();
  if (/udon/.test(name)) return "STALL-11";
  if (/okayu|porridge|poridge/.test(name)) return "STALL-12";
  return "STALL-10";
}

/** Warehouse yang perlu dibuat karena ada di workbook tapi belum ada di database. */
export const NEW_WAREHOUSES = {
  "coffee matcha bar beverage": { code: "STALL-17", name: "Coffee Matcha Bar Beverage" },
};

/** Kategori produk (item.products.kategori) per sheet — mengikuti kode yang sudah dipakai. */
export const SHEET_TO_CATEGORY = {
  "teppanyaki stall": "TEPPANYAKI-STALL",
  "dumpling stall": "DUMPLING-STALL",
  "sushi - sashimi stall": "SUSHI-SASHIMI-STALL",
  "bakery stall": "BAKERY-STALL",
  "burger - sandwiches stall": "BURGER-SANDWICHES-STALL",
  "agemono - frying section stall": "AGEMONO-FRYING-SECTION-STALL",
  "rice bowl stall": "RICE-BOWL-STALL",
  "yakimono - grilled stall": "YAKIMONO-GRIILED-STALL",
  "yakitori stall": "YAKITORI-STALL",
  "onigiri corner stall": "ONIGIRI-CORNER-STALL",
  "yokoco beverage stall": "YOKOCO-BEVERAGE-STALL",
  "coffee matcha bar beverage": "COFFEE-MATCHA-BAR-STALL",
};

export const WAREHOUSE_TO_CATEGORY = {
  "STALL-10": "RAMEN-NOODLES-STALL",
  "STALL-11": "UDON-NOODLES-STALL",
  "STALL-12": "JAPANESE-PORIDGE-STALL",
};

/** Station POS — menentukan ke layar dapur mana order dikirim. */
export function stationFor(sheetName, categoryCode) {
  const hay = `${sheetName} ${categoryCode}`.toLowerCase();
  if (/bakery|pastry|dessert|cake/.test(hay)) return "bakery";
  if (/beverage|barista|coffee|tea|drink|minuman|yokoco/.test(hay)) return "bar";
  return "kitchen";
}
