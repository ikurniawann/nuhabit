import { NextResponse } from "next/server";
import { ApiError, requireApiUser } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { loadGrantedMenuCodesForUser } from "@/lib/iam/has-menu";
import { hasAnyIamMenuPrefix } from "@/lib/iam/match";
import { DESKTOP_OVERVIEW_ROLES } from "@/lib/desktop/overview";
import { subscribeOverview } from "@/lib/desktop/overview-broadcast";

/**
 * Notifikasi desktop lewat Server-Sent Events: server yang memberi tahu saat
 * papan berubah, bukan tiap tab menodong database tiap menit. Hak akses
 * sama persis dengan /api/desktop/overview.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HEARTBEAT_MS = 20_000;

export async function GET() {
  try {
    const user = await requireApiUser();
    const granted = await loadGrantedMenuCodesForUser(user.id, user.role);
    const allowed =
      hasAnyIamMenuPrefix(granted, IAM.dashboard) ||
      (granted.length === 0 && (DESKTOP_OVERVIEW_ROLES as readonly string[]).includes(user.role));
    if (!allowed) throw ApiError.forbidden("Insufficient permissions");

    const encoder = new TextEncoder();
    let unsubscribe: (() => void) | null = null;
    let heartbeat: NodeJS.Timeout | null = null;

    const stream = new ReadableStream({
      start(controller) {
        const send = (event: string, data: unknown) => {
          try {
            controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
          } catch {
            /* klien sudah pergi; pembersihan terjadi di cancel() */
          }
        };
        send("ready", { at: new Date().toISOString() });
        unsubscribe = subscribeOverview(({ overview, hash }) => send("overview", { hash, overview }));
        // Komentar berkala menjaga koneksi tidak ditutup proxy/Cloudflare.
        heartbeat = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(": ping\n\n"));
          } catch {
            /* diabaikan */
          }
        }, HEARTBEAT_MS);
        heartbeat.unref?.();
      },
      cancel() {
        unsubscribe?.();
        if (heartbeat) clearInterval(heartbeat);
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        // Nginx/Cloudflare tidak boleh menahan buffer aliran ini.
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[desktop/stream] gagal:", error);
    return NextResponse.json({ error: "Gagal membuka aliran" }, { status: 500 });
  }
}
