/**
 * Analitik percakapan (ringkasan + kata kunci) — lib BERSAMA.
 *
 * Dipakai dua produk: arkiv-pos-saas (inbox CRM) dan repo `wagateway`. Seluruh
 * folder ini bebas dependensi aplikasi, jadi pemindahannya cukup salin folder —
 * jangan menambahkan impor `next`, `pg`, atau `@/lib/*` di sini.
 */
export * from "./types";
export * from "./keywords";
export * from "./prompt";
export * from "./fingerprint";
