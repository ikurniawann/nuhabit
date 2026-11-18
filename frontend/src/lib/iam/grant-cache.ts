import "server-only";
import { createClient } from "redis";

/**
 * Hash yang sama dengan cache izin API Go
 * (backend/internal/platform/auth/grants.go): field "<user id>:<role>" berisi
 * aksi per kode menu. Go menghapus hash ini setiap Settings → IAM menulis,
 * dan hash kedaluwarsa 60 detik setelah field pertamanya, jadi perubahan data
 * karyawan terlihat paling lama semenit kemudian.
 */
const KEY = "iam:grants";
const TTL_SECONDS = 60;
const COMMAND_TIMEOUT_MS = 250;

type Client = ReturnType<typeof createClient>;
let client: Client | null | undefined;

function redis(): Client | null {
  if (client !== undefined) return client;
  const url = process.env.REDIS_URL?.trim();
  if (!url) return (client = null);
  const created = createClient({
    url,
    disableOfflineQueue: true,
    socket: { connectTimeout: 1000, reconnectStrategy: (retries) => Math.min(retries * 200, 5000) },
  });
  // Kegagalan Redis tidak pernah menggagalkan render: pembaca jatuh ke Postgres.
  created.on("error", () => {});
  void created.connect().catch(() => {});
  return (client = created);
}

function withTimeout<T>(work: Promise<T>): Promise<T> {
  return Promise.race([
    work,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("redis timeout")), COMMAND_TIMEOUT_MS)),
  ]);
}

/**
 * Nilai `load()` untuk `field`, dari Redis bila ada. Tanpa REDIS_URL, atau
 * saat Redis tidak menjawab, `load()` dijalankan langsung.
 */
export async function cachedGrant<T>(field: string, load: () => Promise<T>): Promise<T> {
  const conn = redis();
  if (!conn?.isReady) return load();
  try {
    const hit = await withTimeout(conn.hGet(KEY, field));
    if (hit != null) return JSON.parse(hit) as T;
  } catch {
    return load();
  }
  const value = await load();
  try {
    await withTimeout(conn.multi().hSet(KEY, field, JSON.stringify(value)).expire(KEY, TTL_SECONDS, "NX").exec());
  } catch {
    // Nilai tetap dipakai; percobaan berikutnya menulis ulang.
  }
  return value;
}
