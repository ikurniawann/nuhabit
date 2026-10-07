import { z } from "zod";
import { ApiError } from "@/lib/api/auth";
import { query, queryOne } from "@/lib/db";
import { isUuid } from "./candidate-query";
import { parseJsonBody } from "./route-helpers";

/**
 * Live Monitoring (EPIC-005): kandidat yang sedang psikotes/interview AI
 * mengirim frame webcam kecil tiap beberapa detik (UPSERT 1 baris/sesi),
 * HRD memantau near-live tanpa WebRTC. Live chat dua arah via polling.
 * Dipakai route token kandidat dan route HR /api/recruitment/live-monitoring.
 */

export type LiveSessionType = "psikotes" | "interview";

export const LIVE_SESSION_TABLE: Record<LiveSessionType, string> = {
  psikotes: "recruitment.psikotes_sessions",
  interview: "recruitment.interview_ai_sessions",
};

const FRAME_DATA_URL_RE = /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/;
const MAX_FRAME_CHARS = 400_000; // ~300 KB base64
const MAX_MESSAGE_CHARS = 1000;
const CHAT_LIMIT = 100;
/** Sesi dianggap online bila mengirim frame dalam jendela ini. */
const ONLINE_WINDOW = "60 seconds";
/** Sesi tanpa frame tetap tampil bila kandidat baru saja chat (butuh balasan). */
const CHAT_WINDOW = "10 minutes";

export const liveFrameSchema = z.object({
  frame: z.string().max(MAX_FRAME_CHARS).regex(FRAME_DATA_URL_RE),
});
const chatMessageSchema = z.object({ message: z.string() });

export interface LiveSessionRef {
  id: string;
  candidate_name: string;
  status: string;
}

export interface LiveChatMessage {
  id: string;
  sender: "candidate" | "hr";
  sender_name: string | null;
  message: string;
  created_at: string;
}

export function isLiveSessionType(type: string): type is LiveSessionType {
  return type === "psikotes" || type === "interview";
}

/** Frame kandidat (dataURL jpeg) → UPSERT frame terbaru sesi. */
export async function saveLiveFrame(type: LiveSessionType, sessionId: string, frame: string) {
  await queryOne(
    `INSERT INTO recruitment.live_monitor_frames (session_type, session_id, frame_base64, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (session_type, session_id)
     DO UPDATE SET frame_base64 = EXCLUDED.frame_base64, updated_at = now()
     RETURNING session_id`,
    [type, sessionId, frame.slice(frame.indexOf(",") + 1)]
  );
}

/** Ambil pesan chat satu sesi (dipakai kandidat & HR). */
export async function fetchChatMessages(
  type: LiveSessionType,
  sessionId: string,
  afterIso?: string | null
): Promise<LiveChatMessage[]> {
  if (afterIso) {
    return query<LiveChatMessage>(
      `SELECT id, sender, sender_name, message, created_at
       FROM recruitment.live_chat_messages
       WHERE session_type = $1 AND session_id = $2 AND created_at > $3
       ORDER BY created_at
       LIMIT ${CHAT_LIMIT}`,
      [type, sessionId, afterIso]
    );
  }
  const rows = await query<LiveChatMessage>(
    `SELECT id, sender, sender_name, message, created_at
     FROM recruitment.live_chat_messages
     WHERE session_type = $1 AND session_id = $2
     ORDER BY created_at DESC
     LIMIT ${CHAT_LIMIT}`,
    [type, sessionId]
  );
  return rows.reverse();
}

/** Body {message} → teks pesan, atau 400. */
export async function readChatMessage(request: Request) {
  return (await parseJsonBody(request, chatMessageSchema, "Pesan tidak valid")).message;
}

/** Simpan pesan chat; pesan kosong setelah trim → 400. */
export async function insertChatMessage(input: {
  type: LiveSessionType;
  sessionId: string;
  sender: "candidate" | "hr";
  senderName: string | null;
  message: string;
}): Promise<LiveChatMessage | null> {
  const message = input.message.trim().slice(0, MAX_MESSAGE_CHARS);
  if (!message) throw ApiError.badRequest("Pesan kosong");
  return queryOne<LiveChatMessage>(
    `INSERT INTO recruitment.live_chat_messages
       (session_type, session_id, sender, sender_name, message)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, sender, sender_name, message, created_at`,
    [input.type, input.sessionId, input.sender, input.senderName, message]
  );
}

/** Pesan kandidat: boleh sejak menerima link (sent) sampai sesi berjalan. */
export async function sendCandidateChat(type: LiveSessionType, session: LiveSessionRef, request: Request) {
  if (session.status !== "in_progress" && session.status !== "sent") {
    throw ApiError.conflict("Sesi sudah berakhir");
  }
  return insertChatMessage({
    type,
    sessionId: session.id,
    sender: "candidate",
    senderName: session.candidate_name,
    message: await readChatMessage(request),
  });
}

/** Sesi untuk panel HR; 404 bila tipe/id tidak valid atau sesi tidak ada. */
export async function requireLiveSession(type: string, id: string) {
  if (!isLiveSessionType(type) || !isUuid(id)) throw ApiError.notFound("Sesi tidak ditemukan");
  const session = await queryOne<{ id: string; status: string; candidate_name: string }>(
    `SELECT s.id, s.status, c.full_name AS candidate_name
     FROM ${LIVE_SESSION_TABLE[type]} s JOIN recruitment.candidates c ON c.id = s.candidate_id
     WHERE s.id = $1`,
    [id]
  );
  if (!session) throw ApiError.notFound("Sesi tidak ditemukan");
  return { type, session };
}

/** True bila sesi bertipe `type` dengan id ini sedang in_progress. */
export async function isLiveSessionRunning(type: LiveSessionType, id: string): Promise<boolean> {
  if (!isUuid(id)) return false;
  const row = await queryOne<{ id: string }>(
    `SELECT id FROM ${LIVE_SESSION_TABLE[type]} WHERE id = $1 AND status = 'in_progress'`,
    [id]
  );
  return Boolean(row);
}

export function getLatestFrame(type: LiveSessionType, id: string) {
  return queryOne<{ frame_base64: string; updated_at: string }>(
    `SELECT frame_base64, updated_at FROM recruitment.live_monitor_frames
     WHERE session_type = $1 AND session_id = $2`,
    [type, id]
  );
}

function onlineSessionsSql(type: LiveSessionType) {
  return `SELECT '${type}' AS session_type, s.id AS session_id, s.started_at,
            c.full_name AS candidate_name, p.title AS position_title,
            f.updated_at AS frame_updated_at,
            lc.created_at AS last_message_at, lc.sender AS last_message_sender
     FROM ${LIVE_SESSION_TABLE[type]} s
     JOIN recruitment.candidates c ON c.id = s.candidate_id
     LEFT JOIN hris.positions p ON p.id = c.position_id
     LEFT JOIN recruitment.live_monitor_frames f
       ON f.session_type = '${type}' AND f.session_id = s.id
     LEFT JOIN LATERAL (
       SELECT m.created_at, m.sender FROM recruitment.live_chat_messages m
       WHERE m.session_type = '${type}' AND m.session_id = s.id
       ORDER BY m.created_at DESC LIMIT 1
     ) lc ON true
     WHERE s.status IN ('sent', 'in_progress')
       AND (f.updated_at > now() - interval '${ONLINE_WINDOW}'
            OR (lc.sender = 'candidate' AND lc.created_at > now() - interval '${CHAT_WINDOW}'))`;
}

/**
 * Sesi berjalan DAN online (frame < 60 dtk, atau chat kandidat < 10 menit)
 * untuk halaman thumbnail; sesi basi (tab ditutup) tidak ditampilkan.
 */
export function listOnlineLiveSessions() {
  return query(
    `${onlineSessionsSql("psikotes")}

     UNION ALL

     ${onlineSessionsSql("interview")}

     ORDER BY started_at DESC NULLS LAST`
  );
}
