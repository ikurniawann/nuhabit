/**
 * Probe kesiapan: aplikasi siap melayani bila database menjawab `SELECT 1`
 * dalam batas waktu. Dipisah dari route agar bisa diuji tanpa server.
 */

export type ReadinessResult =
  | { ok: true; latencyMs: number }
  | { ok: false; latencyMs: number; error: string };

type Queryable = { query: (text: string) => Promise<unknown> };

export const READY_TIMEOUT_MS = 2000;

export async function checkDatabaseReady(
  getDb: () => Queryable,
  timeoutMs = READY_TIMEOUT_MS
): Promise<ReadinessResult> {
  const started = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`database tidak menjawab dalam ${timeoutMs} ms`)),
      timeoutMs
    );
  });

  try {
    await Promise.race([getDb().query("SELECT 1"), timeout]);
    return { ok: true, latencyMs: Date.now() - started };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      error: error instanceof Error ? error.message : "database tidak tersedia",
    };
  } finally {
    clearTimeout(timer);
  }
}
