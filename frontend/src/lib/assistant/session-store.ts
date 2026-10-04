import { appendFile, mkdir } from "fs/promises";
import path from "path";
import type { AiAssistantScope } from "@/lib/ai-assistant-config";
import type { AssistantIntent } from "@/lib/assistant/context";
import type { ChatMessage, LlmResult } from "@/lib/assistant/llm";
import type { DbAdmin } from "@/lib/assistant/summary";

/** Riwayat sesi, lampiran, dan jejak audit asisten Do. */

type Intent = AssistantIntent;

/** Lampiran yang sudah divalidasi & dibatasi, siap masuk prompt. */
export type SafeAttachment = { name: string; text: string; truncated: boolean };

/**
 * Isi lampiran datang dari klien (hasil endpoint ekstraksi), jadi tetap
 * dibatasi di sini: jumlah file, panjang per file, dan total gabungan. Tanpa
 * batas ini satu permintaan bisa membengkak tak terkendali.
 */
const MAX_ATTACHMENTS = 5;
const MAX_ATTACHMENT_TEXT = 20_000;
const MAX_ATTACHMENT_TOTAL = 40_000;

export function sanitizeAttachments(input: unknown): SafeAttachment[] {
  if (!Array.isArray(input)) return [];
  const out: SafeAttachment[] = [];
  let total = 0;

  for (const item of input.slice(0, MAX_ATTACHMENTS)) {
    if (!item || typeof item !== "object") continue;
    const raw = item as { name?: unknown; text?: unknown };
    const text = typeof raw.text === "string" ? raw.text.trim() : "";
    if (!text) continue;

    const name = typeof raw.name === "string" && raw.name.trim() ? raw.name.trim().slice(0, 120) : "lampiran";
    const sisa = MAX_ATTACHMENT_TOTAL - total;
    if (sisa <= 0) break;

    const batas = Math.min(MAX_ATTACHMENT_TEXT, sisa);
    const dipotong = text.length > batas;
    out.push({ name, text: dipotong ? text.slice(0, batas) : text, truncated: dipotong });
    total += Math.min(text.length, batas);
  }

  return out;
}

export function compactChatHistory(history: ChatMessage[]): ChatMessage[] {
  const compacted: ChatMessage[] = [];
  let budget = 5000;

  for (const item of history.slice(-12).reverse()) {
    const maxLength = item.role === "assistant" ? 900 : 700;
    const content = item.content.replace(/\s+/g, " ").trim().slice(0, maxLength);
    if (!content) continue;

    budget -= content.length;
    if (budget < 0) break;
    compacted.push({ role: item.role, content });
  }

  return compacted.reverse();
}

/** Penyimpanan pesan + log markdown + audit, dipakai jalur stream & non-stream. */
export async function persistAndAudit({
  admin,
  sessionId,
  prompt,
  llmResult,
  intent,
  scope,
  userId,
  userEmail,
  userName,
  startedAt,
}: {
  admin: DbAdmin;
  sessionId?: string;
  prompt: string;
  llmResult: LlmResult;
  intent: Intent;
  scope: AiAssistantScope;
  userId: string;
  userEmail: string;
  userName: string;
  startedAt: number;
}) {
  if (sessionId) {
    await admin.from("ai_assistant_messages").insert([
      { session_id: sessionId, role: "user", content: prompt },
      {
        session_id: sessionId,
        role: "assistant",
        content: llmResult.answer,
        meta: {
          mode: llmResult.mode,
          model: llmResult.model,
          status: llmResult.status,
          intent,
          scope,
          // Ikut disimpan supaya kartu konfirmasi tetap tampil saat sesi dibuka
          // ulang (statusnya diverifikasi lagi oleh endpoint konfirmasi).
          ...(llmResult.pendingAction ? { pending_action: llmResult.pendingAction } : {}),
        },
      },
    ]);
  }

  await appendAssistantMarkdown({
    userId,
    userEmail,
    userName,
    sessionId,
    prompt,
    answer: llmResult.answer,
    model: llmResult.model,
    scope,
  });

  await auditAiRequest(admin, {
    user_id: userId,
    user_email: userEmail,
    prompt,
    intent,
    mode: llmResult.mode,
    model: llmResult.model,
    latency_ms: Date.now() - startedAt,
    error: llmResult.error,
  });
}

export async function loadSessionHistory(admin: DbAdmin, sessionId: string): Promise<ChatMessage[]> {
  try {
    const { data } = await admin
      .from("ai_assistant_messages")
      .select("role, content")
      .eq("session_id", sessionId)
      .in("role", ["user", "assistant"])
      .order("created_at", { ascending: true })
      .limit(40);
    return ((data ?? []) as Array<{ role?: string; content?: unknown }>)
      .filter((item): item is ChatMessage => (item.role === "user" || item.role === "assistant") && typeof item.content === "string")
      .map((item) => ({ role: item.role, content: item.content }));
  } catch {
    return [];
  }
}

async function appendAssistantMarkdown(payload: {
  userId: string;
  userEmail: string;
  userName: string;
  sessionId?: string;
  prompt: string;
  answer: string;
  model: string;
  scope: AiAssistantScope;
}) {
  if (process.env.VERCEL === "1") return;

  try {
    const logsDir = path.join(process.cwd(), "assistant-memory");
    await mkdir(logsDir, { recursive: true });
    const safeUser = payload.userEmail.replace(/[^a-zA-Z0-9._-]/g, "_");
    const filePath = path.join(logsDir, `${safeUser}.assistant.md`);
    const block = [
      `\n\n---`,
      `date: ${new Date().toISOString()}`,
      `user: ${payload.userName} <${payload.userEmail}>`,
      `user_id: ${payload.userId}`,
      `session_id: ${payload.sessionId ?? "none"}`,
      `model: ${payload.model}`,
      `scope: ${payload.scope}`,
      `\n## User`,
      payload.prompt,
      `\n## Assistant`,
      payload.answer,
    ].join("\n");
    await appendFile(filePath, block, "utf8");
  } catch (error) {
    console.warn("assistant.md write skipped:", error instanceof Error ? error.message : error);
  }
}

async function auditAiRequest(admin: DbAdmin, payload: Record<string, unknown>) {
  try {
    await admin.from("ai_assistant_logs").insert(payload);
  } catch (error) {
    console.warn("AI audit log skipped:", error instanceof Error ? error.message : error);
  }
}
