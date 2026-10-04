import { getPool } from "@/lib/db";
import { checkDatabaseReady } from "@/lib/ops/readiness";

export const dynamic = "force-dynamic";

/** GET /api/ready — 200 bila database menjawab, 503 bila tidak. Publik (tanpa sesi). */
export async function GET() {
  const result = await checkDatabaseReady(getPool);
  const body = result.ok
    ? { status: "ready", database: "ok", latency_ms: result.latencyMs }
    : {
        status: "unavailable",
        database: "error",
        latency_ms: result.latencyMs,
        error: result.error,
      };
  return Response.json(body, {
    status: result.ok ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
