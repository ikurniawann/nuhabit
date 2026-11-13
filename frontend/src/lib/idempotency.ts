/** Header yang dibaca middleware idempotency di API Go. */
export const IDEMPOTENCY_HEADER = "Idempotency-Key";

const lastAttempt = new Map<string, { body: string; key: string }>();

/**
 * Kunci untuk satu percobaan transaksi. Mengirim ulang body yang sama setelah
 * gagal (timeout, jaringan putus) memakai kunci yang sama, jadi server
 * memutar ulang respons pertama alih-alih mencatat transaksi kedua. Body lain
 * mendapat kunci baru. Panggil `settleRetryKey` setelah respons sukses agar
 * transaksi berikutnya dengan isi yang sama tetap tercatat.
 */
export function retryKey(scope: string, body: unknown): string {
  const json = JSON.stringify(body);
  const last = lastAttempt.get(scope);
  if (last?.body === json) return last.key;
  const key = crypto.randomUUID();
  lastAttempt.set(scope, { body: json, key });
  return key;
}

export function settleRetryKey(scope: string) {
  lastAttempt.delete(scope);
}

/**
 * Menjalankan `send` dengan kunci dari `retryKey` (atau `key` bila pemanggil
 * sudah punya kunci tetap, misalnya antrean offline) dan melepas kunci
 * setelah sukses.
 */
export async function withRetryKey<T>(
  scope: string,
  body: unknown,
  send: (headers: Record<string, string>) => Promise<T>,
  key?: string
): Promise<T> {
  const result = await send({ [IDEMPOTENCY_HEADER]: key ?? retryKey(scope, body) });
  if (!key) settleRetryKey(scope);
  return result;
}
