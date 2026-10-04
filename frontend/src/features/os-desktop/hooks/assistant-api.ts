import { extractSseData, splitSseEvents } from "@/lib/assistant/sse";
import {
  mapSessionMessages,
  type AssistantAttachment,
  type AssistantMessage,
  type AssistantMeta,
  type AssistantSession,
  type PendingAction,
} from "../lib/assistant-chat";

/** Panggilan HTTP asisten Do (/api/ai/assistant). */

const ENDPOINT = "/api/ai/assistant";

export async function fetchSessions(): Promise<AssistantSession[]> {
  const res = await fetch(`${ENDPOINT}?list=true`);
  const data = await res.json();
  return data.sessions ?? [];
}

export async function fetchSessionMessages(id: string): Promise<AssistantMessage[]> {
  const res = await fetch(`${ENDPOINT}?session_id=${id}`);
  const data = await res.json();
  return mapSessionMessages(data.messages);
}

export async function renameSession(id: string, title: string): Promise<void> {
  const res = await fetch(`${ENDPOINT}?session_id=${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
  if (!res.ok) throw new Error("gagal");
}

export async function deleteSession(id: string): Promise<void> {
  const res = await fetch(`${ENDPOINT}?session_id=${encodeURIComponent(id)}`, { method: "DELETE" });
  const json = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(json.error || "Gagal menghapus session");
}

export async function uploadAttachment(file: File): Promise<AssistantAttachment> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${ENDPOINT}/attachment`, { method: "POST", body: form });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || `Gagal membaca ${file.name}`);
  return json.data as AssistantAttachment;
}

/**
 * Keputusan user atas usulan aksi tulis. Eksekusi nyata terjadi di server
 * (endpoint konfirmasi memverifikasi kepemilikan, status pending, dan TTL).
 */
export async function decidePendingAction(
  actionId: string,
  decision: "confirm" | "cancel"
): Promise<{ status: PendingAction["status"]; note: string }> {
  const res = await fetch(`${ENDPOINT}/actions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action_id: actionId, decision }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    action?: { status?: PendingAction["status"] };
    message?: string;
    error?: string;
  };
  return {
    status: json.action?.status ?? "failed",
    note: json.message ?? json.error ?? (res.ok ? "" : "Gagal memproses aksi"),
  };
}

export type AssistantReply = { session_id?: string; answer?: string; meta?: AssistantMeta };

export async function postAssistantMessage(body: Record<string, unknown>): Promise<Response> {
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, stream: true }),
  });
  if (!response.ok) {
    const failure = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(failure.error || "Do gagal merespons");
  }
  return response;
}

/**
 * Baca jawaban SSE: `onDelta` per potongan token, `onDone` dengan jawaban
 * final dari server. Event `error` dilempar sebagai Error.
 */
export async function readAssistantStream(
  body: ReadableStream<Uint8Array>,
  handlers: { onDelta: (text: string) => void; onDone: (reply: AssistantReply) => void }
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });
    const { events, rest } = splitSseEvents(buffer);
    buffer = rest;
    for (const event of events) {
      for (const raw of extractSseData(event)) {
        let payload: AssistantReply & { type?: string; text?: string; error?: string };
        try {
          payload = JSON.parse(raw);
        } catch {
          continue;
        }
        if (payload.type === "delta" && payload.text) handlers.onDelta(payload.text);
        else if (payload.type === "done") handlers.onDone(payload);
        else if (payload.type === "error") throw new Error(payload.error || "Do gagal merespons");
      }
    }
  }
}
