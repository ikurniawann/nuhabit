import { NextRequest, NextResponse } from "next/server";
import { createPgClient } from "@/lib/pg/create-client";
import { createServerPgClient } from "@/lib/pg/create-client";
import { resolveAiAssistantModel, resolveAiAssistantScope } from "@/lib/ai-assistant-config";
import { allowedToolNames } from "@/lib/assistant/tool-scope";
import { loadGrantedMenuCodesForUser } from "@/lib/iam/has-menu";
import type { AssistantIntent } from "@/lib/assistant/context";
import { generateAnswer, type ChatMessage, type LlmResult } from "@/lib/assistant/llm";
import {
  compactChatHistory,
  loadSessionHistory,
  persistAndAudit,
  sanitizeAttachments,
} from "@/lib/assistant/session-store";
import {
  buildSystemSummary,
  createEmptySystemSummary,
  detectIntent,
  generateSummaryAnswer,
  logContextSaving,
  type DbAdmin,
} from "@/lib/assistant/summary";

type Intent = AssistantIntent;

export async function GET(request: NextRequest) {
  try {
    const db = await createServerPgClient();
    const { data: { user } } = await db.auth.getUser();
    if (!user) return NextResponse.json({ error: "Login required" }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get("session_id");
    const list = searchParams.get("list") === "true";

    const admin = createPgClient();

    if (list || !sessionId) {
      const { data: sessions, error } = await admin
        .from("ai_assistant_sessions")
        .select("id, title, created_at, updated_at")
        .eq("user_id", user.id)
        .order("updated_at", { ascending: false })
        .limit(30);
      if (error) throw error;
      return NextResponse.json({ sessions: sessions ?? [] });
    }

    // Verify the session belongs to the requesting user before returning its
    // messages — admin client bypasses RLS, so ownership must be checked here.
    const { data: ownedSession } = await admin
      .from("ai_assistant_sessions")
      .select("id")
      .eq("id", sessionId)
      .eq("user_id", user.id)
      .single();
    if (!ownedSession) {
      return NextResponse.json({ error: "Session tidak ditemukan" }, { status: 404 });
    }

    const { data: messages, error } = await admin
      .from("ai_assistant_messages")
      .select("id, role, content, meta, created_at")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: true });
    if (error) throw error;
    return NextResponse.json({ messages: messages ?? [] });
  } catch (error) {
    console.error("AI assistant GET error:", error);
    return NextResponse.json({ error: "Gagal memuat history" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const db = await createServerPgClient();
    const {
      data: { user },
    } = await db.auth.getUser();

    if (!user) return NextResponse.json({ error: "Login required" }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get("session_id");
    if (!sessionId) return NextResponse.json({ error: "session_id required" }, { status: 400 });

    const admin = createPgClient();

    const { error } = await admin
      .from("ai_assistant_sessions")
      .delete()
      .eq("id", sessionId)
      .eq("user_id", user.id);
    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("AI assistant DELETE error:", error);
    return NextResponse.json({ error: "Gagal menghapus session" }, { status: 500 });
  }
}

/** PATCH /api/ai/assistant?session_id=… — ganti judul sesi milik sendiri. */
export async function PATCH(request: NextRequest) {
  try {
    const db = await createServerPgClient();
    const {
      data: { user },
    } = await db.auth.getUser();
    if (!user) return NextResponse.json({ error: "Login required" }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get("session_id");
    if (!sessionId) return NextResponse.json({ error: "session_id required" }, { status: 400 });

    const body = (await request.json()) as { title?: unknown };
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title) return NextResponse.json({ error: "Judul tidak boleh kosong" }, { status: 400 });

    const admin = createPgClient();
    // eq(user_id) wajib: admin client melewati RLS, jadi kepemilikan diperiksa
    // di sini — tanpa itu siapa pun bisa mengganti judul sesi orang lain.
    const { error } = await admin
      .from("ai_assistant_sessions")
      .update({ title: title.slice(0, 120), updated_at: new Date().toISOString() })
      .eq("id", sessionId)
      .eq("user_id", user.id);
    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("AI assistant PATCH error:", error);
    return NextResponse.json({ error: "Gagal mengganti judul" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  let prompt = "";
  let intent: Intent = "all";

  try {
    const body = (await request.json()) as {
      message?: string;
      history?: ChatMessage[];
      session_id?: string;
      model?: string;
      scope?: string;
      stream?: boolean;
      attachments?: Array<{ name?: unknown; text?: unknown }>;
    };
    prompt = body.message ?? "Summary semua module";
    let sessionId = body.session_id;
    const history = (body.history ?? []).slice(-8);
    const model = resolveAiAssistantModel(body.model);
    const scope = resolveAiAssistantScope(body.scope);
    const includeProjectData = scope !== "general";
    const attachments = sanitizeAttachments(body.attachments);

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

    /**
     * Do terbuka untuk semua yang login, TAPI alatnya mengikuti hak menu IAM
     * (lihat tool-scope). Dulu dikunci super_admin karena alat bisa membaca
     * data karyawan/penjualan; sekarang pembatasnya per-alat, bukan per-orang,
     * sehingga kasir bisa bertanya soal stok tanpa bisa menarik data HRIS.
     * Gate tetap ditegakkan di SERVER, bukan hanya di UI.
     */
    const grantedMenus = await loadGrantedMenuCodesForUser(user.id, profile?.role ?? "");
    const toolAllowList = allowedToolNames(profile?.role, grantedMenus);

    const admin = createPgClient();

    intent = includeProjectData ? detectIntent(prompt) : "all";
    const summary = includeProjectData
      ? await buildSystemSummary(admin as unknown as DbAdmin, intent)
      : createEmptySystemSummary();
    if (includeProjectData) logContextSaving(summary, intent);

    const fallbackAnswer = includeProjectData
      ? generateSummaryAnswer(prompt, summary, profile?.full_name ?? user.email ?? "User", intent)
      : "Do belum bisa menghubungi tingkat yang dipilih saat ini. Coba lagi sebentar atau pilih tingkat lain di NüHabit OS Settings.";

    // Create session if none exists (first user message in a fresh chat)
    if (!sessionId) {
      const { data: newSession, error: se } = await admin
        .from("ai_assistant_sessions")
        .insert({ user_id: user.id, title: prompt.slice(0, 120) })
        .select("id")
        .single();
      if (!se && typeof newSession?.id === "string") sessionId = newSession.id;
    } else {
      // Update session timestamp on activity — scope to the owner so one user
      // cannot touch another user's session by passing a stolen session_id.
      await admin
        .from("ai_assistant_sessions")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", sessionId)
        .eq("user_id", user.id);
    }

    const persistedHistory = sessionId ? await loadSessionHistory(admin as unknown as DbAdmin, sessionId) : [];
    const mergedHistory = compactChatHistory([...persistedHistory, ...history]);

    const userName = profile?.full_name ?? user.email ?? "User";

    /** Simpan pesan, tulis log markdown, audit — sama untuk stream & non-stream. */
    const finalize = async (llmResult: LlmResult) => {
      await persistAndAudit({
        admin: admin as unknown as DbAdmin,
        sessionId,
        prompt,
        llmResult,
        intent,
        scope,
        userId: user.id,
        userEmail: user.email ?? "unknown",
        userName,
        startedAt,
      });
      return {
        mode: llmResult.mode,
        model: llmResult.model,
        intent,
        scope,
        status: llmResult.status,
        fallbackReason: llmResult.fallbackReason,
        user: user.email,
        // Kartu konfirmasi aksi tulis dirender UI dari sini (Fase E).
        pending_action: llmResult.pendingAction ?? undefined,
      };
    };

    if (body.stream === true) {
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          const send = (payload: unknown) =>
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
          try {
            const llmResult = await generateAnswer({
              message: prompt,
              history: mergedHistory,
              summary,
              fallbackAnswer,
              userName,
              intent,
              scope,
              model,
              attachments,
              actionCtx: { userId: user.id, userName, sessionId },
              toolAllowList,
              onDelta: (text) => send({ type: "delta", text }),
            });
            // Penyimpanan dilakukan SETELAH stream selesai, memakai teks utuh
            // yang dikumpulkan server — bukan hasil rakitan klien.
            const meta = await finalize(llmResult);
            send({ type: "done", answer: llmResult.answer, session_id: sessionId, meta });
          } catch (error) {
            console.error("AI assistant stream error:", error);
            send({ type: "error", error: "Gagal memproses permintaan Do" });
          } finally {
            controller.close();
          }
        },
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          // Cegah proxy (nginx/cloudflared) menahan buffer sampai stream tuntas —
          // tanpa ini jawaban tetap muncul sekaligus meski sudah streaming.
          "X-Accel-Buffering": "no",
        },
      });
    }

    const llmResult = await generateAnswer({
      message: prompt,
      history: mergedHistory,
      summary,
      fallbackAnswer,
      userName,
      intent,
      scope,
      model,
      attachments,
      actionCtx: { userId: user.id, userName, sessionId },
      toolAllowList,
    });

    // Persist messages
    const meta = await finalize(llmResult);

    return NextResponse.json({
      answer: llmResult.answer,
      summary,
      session_id: sessionId,
      meta,
    });
  } catch (error) {
    console.error("AI assistant error:", error);
    return NextResponse.json({ error: "Gagal memproses permintaan Do" }, { status: 500 });
  }
}
