/**
 * Aturan login portal member dengan password — murni (tanpa DB/next) supaya
 * validasi bisa diuji langsung dan dipakai bersama route API.
 *
 * Konteks keamanan (2026-10-08): `/api/member-portal/login` sempat menerima
 * username SAJA — baris password dikomentari, jadi siapa pun yang tahu nomor
 * WA/email seorang member mendapat sesi tanpa verifikasi. Modul ini menegakkan
 * password wajib; route lalu memverifikasi hash bcrypt
 * `pos.pos_customers.password_hash` sebelum menerbitkan sesi.
 */

/** Panjang minimum username (nomor WA/email selalu lebih panjang dari ini). */
export const LOGIN_USERNAME_MIN = 3;

/** Pesan seragam untuk akun tak dikenal maupun password salah (anti-enumerasi). */
export const LOGIN_INVALID_MESSAGE = "Username atau password salah";

/** Akun ada, tetapi belum punya password (member lama yang di-enroll kasir). */
export const LOGIN_NO_PASSWORD_MESSAGE =
  "Akun ini belum punya password. Hubungi kasir untuk mengaturnya.";

export const LOGIN_ACCOUNT_LIMIT_MESSAGE =
  "Terlalu banyak percobaan masuk untuk akun ini. Coba lagi beberapa menit lagi";

/**
 * Hash bcrypt dari nilai acak yang langsung dibuang: dipakai sebagai pembanding
 * saat akun tidak ditemukan, supaya waktu respons tidak membedakan
 * "akun tidak ada" dari "password salah".
 */
export const DUMMY_PASSWORD_HASH = "$2b$10$mbJFCn7gNj4UuPSHt7GCl.Q1ukFRPUxXtdTlEOyiALazTx0c//3p6";

export type LoginField = "username" | "password";

export type LoginValidation =
  | { ok: true; value: { username: string; password: string } }
  | { ok: false; field: LoginField; error: string };

/**
 * Validasi input login. Password hanya diwajibkan ADA — panjang/kompleksitas
 * TIDAK ditegakkan di sini supaya password lama (atau yang dibuat kasir) tetap
 * bisa masuk; aturan kuat berlaku saat password dibuat, bukan saat dipakai.
 */
export function validateLoginInput(input: {
  username?: unknown;
  password?: unknown;
}): LoginValidation {
  const username = typeof input.username === "string" ? input.username.trim() : "";
  if (username.length < LOGIN_USERNAME_MIN) {
    return { ok: false, field: "username", error: "Username wajib diisi" };
  }
  const password = typeof input.password === "string" ? input.password : "";
  if (!password) {
    return { ok: false, field: "password", error: "Password wajib diisi" };
  }
  return { ok: true, value: { username, password } };
}
