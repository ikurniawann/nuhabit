/**
 * Klien API POS (browser → /api/pos). Implementasi per sumber daya ada di
 * src/lib/pos/api-client/*; modul ini titik impor tunggal yang dipakai fitur.
 */
export type { ApiResult } from "./pos/api-client/http";
export * from "./pos/api-client/catalog";
export * from "./pos/api-client/orders";
export * from "./pos/api-client/checkouts";
export * from "./pos/api-client/tables";
export * from "./pos/api-client/wallet";
export * from "./pos/api-client/reservations";
export * from "./pos/api-client/shifts";
