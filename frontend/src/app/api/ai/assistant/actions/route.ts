import { NextRequest, NextResponse } from "next/server";
import { createServerPgClient } from "@/lib/pg/create-client";
import { query } from "@/lib/db";
import { getWriteAction, type WriteActionStatus } from "@/lib/assistant/write-tools";

/**
 * Konfirmasi/pembatalan aksi tulis Do (EPIC-017 Fase E).
 *
 * Ini SATU-SATUNYA jalur eksekusi aksi tulis asisten:
 * - hanya pemilik usulan (dan role super_admin, selaras gate Do) yang boleh
 *   memutuskan;
 * - klaim baris dilakukan atomik (`UPDATE ... WHERE status='pending'`) supaya
 *   dua klik konkuren tidak mengeksekusi dua kali;
 * - usulan kedaluwarsa 10 menit setelah dibuat.
 */

const ACTION_TTL = "10 minutes";

type ActionRow = {
  id: string;
  action_name: string;
  payload: Record<string, unknown>;
  summary: string;
  status: WriteActionStatus;
};

function actionResponse(row: { id: string; summary: string }, status: WriteActionStatus, message: string, extra?: Record<string, unknown>) {
  return NextResponse.json({
    action: { id: row.id, summary: row.summary, status, ...extra },
    message,
  });
}

export async function POST(request: NextRequest) {
  try {
    const db = await createServerPgClient();
    const {
      data: { user },
    } = await db.auth.getUser();
    if (!user) return NextResponse.json({ error: "Login required" }, { status: 401 });

    const { data: profile } = await db
      .from("users")
      .select("role, full_name")
      .eq("id", user.id)
      .single();
    // Do sendiri digate super_admin; eksekusi aksinya tidak boleh lebih longgar.
    if (profile?.role !== "super_admin") {
      return NextResponse.json({ error: "Hanya super_admin yang bisa mengeksekusi aksi Do" }, { status: 403 });
    }

    const body = (await request.json().catch(() => ({}))) as { action_id?: unknown; decision?: unknown };
    const actionId = typeof body.action_id === "string" ? body.action_id : "";
    const decision = body.decision === "confirm" || body.decision === "cancel" ? body.decision : null;
    if (!/^[0-9a-f-]{36}$/i.test(actionId) || !decision) {
      return NextResponse.json({ error: "Permintaan tidak valid" }, { status: 400 });
    }

    // Usulan basi ditandai kedaluwarsa lebih dulu — klik pada kartu lama tidak
    // boleh mengeksekusi aksi yang usernya sudah lupa konteksnya.
    await query(
      `UPDATE ai_assistant_actions
          SET status = 'expired', decided_at = now()
        WHERE id = $1 AND user_id = $2 AND status = 'pending'
          AND created_at < now() - interval '${ACTION_TTL}'`,
      [actionId, user.id]
    );

    if (decision === "cancel") {
      const [row] = await query<ActionRow>(
        `UPDATE ai_assistant_actions
            SET status = 'cancelled', decided_by = $2, decided_at = now()
          WHERE id = $1 AND user_id = $2 AND status = 'pending'
          RETURNING id, action_name, payload, summary, status`,
        [actionId, user.id]
      );
      if (!row) return await respondNotClaimable(actionId, user.id);
      return actionResponse(row, "cancelled", "Aksi dibatalkan. Tidak ada data yang berubah.");
    }

    // Klaim atomik: hanya satu request yang bisa memindahkan pending → confirmed.
    const [claimed] = await query<ActionRow>(
      `UPDATE ai_assistant_actions
          SET status = 'confirmed', decided_by = $2, decided_at = now()
        WHERE id = $1 AND user_id = $2 AND status = 'pending'
        RETURNING id, action_name, payload, summary, status`,
      [actionId, user.id]
    );
    if (!claimed) return await respondNotClaimable(actionId, user.id);

    const action = getWriteAction(claimed.action_name);
    if (!action) {
      // Whitelist berubah antara usulan dan konfirmasi (mis. setelah deploy).
      await markFailed(claimed.id, "Aksi sudah tidak tersedia");
      return NextResponse.json({ error: "Aksi sudah tidak tersedia" }, { status: 410 });
    }

    try {
      const result = await action.execute(claimed.payload, {
        userId: user.id,
        userName: profile?.full_name ?? user.email ?? "super_admin",
      });
      await query(
        `UPDATE ai_assistant_actions
            SET result = $2, executed_at = now()
          WHERE id = $1`,
        [claimed.id, JSON.stringify(result)]
      );
      console.info(`[do:write] ${claimed.action_name} dieksekusi oleh ${user.email} (${claimed.id})`);
      return actionResponse(claimed, "confirmed", "Aksi berhasil dijalankan.", { result });
    } catch (error) {
      console.error(`[do:write] eksekusi ${claimed.action_name} gagal:`, error);
      await markFailed(claimed.id, error instanceof Error ? error.message : "unknown");
      return NextResponse.json(
        { action: { id: claimed.id, summary: claimed.summary, status: "failed" }, error: "Aksi gagal dijalankan" },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error("AI assistant action error:", error);
    return NextResponse.json({ error: "Gagal memproses aksi" }, { status: 500 });
  }
}

/** Baris tidak bisa diklaim: sudah diputuskan, kedaluwarsa, atau bukan milik user. */
async function respondNotClaimable(actionId: string, userId: string) {
  const [existing] = await query<{ id: string; summary: string; status: WriteActionStatus }>(
    `SELECT id, summary, status FROM ai_assistant_actions WHERE id = $1 AND user_id = $2`,
    [actionId, userId]
  );
  if (!existing) return NextResponse.json({ error: "Aksi tidak ditemukan" }, { status: 404 });
  const label: Record<string, string> = {
    confirmed: "Aksi ini sudah dijalankan sebelumnya.",
    cancelled: "Aksi ini sudah dibatalkan.",
    expired: "Aksi sudah kedaluwarsa (lebih dari 10 menit). Minta Do menyiapkannya lagi.",
    failed: "Aksi ini sebelumnya gagal dijalankan.",
  };
  return NextResponse.json(
    {
      action: { id: existing.id, summary: existing.summary, status: existing.status },
      error: label[existing.status] ?? "Aksi tidak bisa diproses",
    },
    { status: 409 }
  );
}

async function markFailed(actionId: string, message: string) {
  try {
    await query(
      `UPDATE ai_assistant_actions SET status = 'failed', error = $2 WHERE id = $1`,
      [actionId, message.slice(0, 500)]
    );
  } catch (error) {
    console.warn("[do:write] gagal menandai failed:", error);
  }
}
