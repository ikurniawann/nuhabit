export const dynamic = "force-dynamic";

/** GET /api/health — proses hidup. Tidak menyentuh database (lihat /api/ready). */
export async function GET() {
  return Response.json(
    { status: "ok", uptime_s: Math.round(process.uptime()) },
    { headers: { "Cache-Control": "no-store" } }
  );
}
