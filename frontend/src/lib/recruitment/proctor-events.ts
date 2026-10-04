import { ApiError } from "@/lib/api/auth";
import { query, queryOne } from "@/lib/db";
import { savePrivateImage, sniffImageMime } from "@/lib/storage-private";
import { LIVE_SESSION_TABLE, type LiveSessionType } from "./live-monitor";

/**
 * Bukti proctoring psikotes & interview AI: flag perilaku + snapshot webcam
 * di storage PRIVATE (dibaca HR lewat /api/<tipe>/files yang ber-auth).
 */

/** Batas snapshot webcam tersimpan per sesi (kuota storage, cegah disk-fill DoS). */
const MAX_SNAPSHOTS_PER_SESSION = 300;
const MAX_EVENTS = 1000;

const EVENT_TABLE: Record<LiveSessionType, string> = {
  psikotes: "recruitment.psikotes_proctor_events",
  interview: "recruitment.interview_ai_proctor_events",
};

export interface ProctorEventInput {
  event_type: string;
  meta?: Record<string, string | number | boolean>;
  snapshot?: string;
}

/** "data:image/jpeg;base64,xxx" → mime + isi byte. Format sudah dijaga zod. */
export function decodeSnapshot(dataUrl: string): { mime: string; buffer: Buffer } {
  const [head, base64 = ""] = dataUrl.split(",", 2);
  return {
    mime: head.slice("data:".length, head.indexOf(";")),
    buffer: Buffer.from(base64, "base64"),
  };
}

async function saveSnapshot(type: LiveSessionType, sessionId: string, snapshot: string | undefined) {
  if (!snapshot) throw ApiError.badRequest("Snapshot kosong");
  const count = await queryOne<{ n: number }>(
    `SELECT count(*)::int AS n FROM ${EVENT_TABLE[type]}
     WHERE session_id = $1 AND event_type = 'webcam_snapshot'`,
    [sessionId]
  );
  if ((count?.n ?? 0) >= MAX_SNAPSHOTS_PER_SESSION) {
    throw ApiError.tooManyRequests("Kuota snapshot sesi tercapai");
  }
  const { mime, buffer } = decodeSnapshot(snapshot);
  if (!sniffImageMime(buffer)) throw ApiError.badRequest("Isi snapshot bukan gambar valid");
  const saved = await savePrivateImage(buffer, mime, `${type}/${sessionId}/proctor`);
  if (!saved.path) throw new ApiError(500, saved.error ?? "Gagal menyimpan snapshot");
  return saved.path;
}

/** Catat satu event proctoring; snapshot disimpan dulu bila event_type webcam_snapshot. */
export async function recordProctorEvent(type: LiveSessionType, sessionId: string, input: ProctorEventInput) {
  const storagePath =
    input.event_type === "webcam_snapshot" ? await saveSnapshot(type, sessionId, input.snapshot) : null;
  return queryOne<{ id: string; event_type: string; created_at: string }>(
    `INSERT INTO ${EVENT_TABLE[type]} (session_id, event_type, meta, storage_path)
     VALUES ($1, $2, $3, $4)
     RETURNING id, event_type, created_at`,
    [sessionId, input.event_type, input.meta ? JSON.stringify(input.meta) : null, storagePath]
  );
}

/** Arsip bukti proctoring satu sesi utk HR; 404 bila sesi tidak ada. */
export async function listProctorEvents(type: LiveSessionType, sessionId: string) {
  const session = await queryOne<{ id: string }>(
    `SELECT id FROM ${LIVE_SESSION_TABLE[type]} WHERE id = $1`,
    [sessionId]
  );
  if (!session) throw ApiError.notFound("Sesi tidak ditemukan");
  return query(
    `SELECT id, event_type, meta, storage_path, created_at
     FROM ${EVENT_TABLE[type]}
     WHERE session_id = $1
     ORDER BY created_at
     LIMIT ${MAX_EVENTS}`,
    [sessionId]
  );
}
