import { NextRequest, NextResponse } from "next/server";
import { createPgClient } from "@/lib/pg/create-client";
import { createServerPgClient } from "@/lib/pg/create-client";
import {
  type AiAssistantModel,
  type AiAssistantScope,
  modelSupportsTemperature,
  resolveAiAssistantModel,
  resolveAiAssistantScope,
  stripOpenAiPrefix,
} from "@/lib/ai-assistant-config";
import { SETTING_KEYS, getSettings } from "@/lib/settings/app-settings";
import { extractSseData, readOpenAiDelta, splitSseEvents } from "@/lib/assistant/sse";
import { contextSizeChars, selectContextForIntent, type AssistantIntent } from "@/lib/assistant/context";
import { parseToolArguments, runTool, toolDefinitions } from "@/lib/assistant/tools";
import { allowedToolNames } from "@/lib/assistant/tool-scope";
import { loadGrantedMenuCodesForUser } from "@/lib/iam/has-menu";
import {
  isWriteActionName,
  proposeWriteAction,
  writeToolDefinitions,
  type PendingActionMeta,
} from "@/lib/assistant/write-tools";
import { appendFile, mkdir } from "fs/promises";
import path from "path";

type ChatMessage = { role: "user" | "assistant"; content: string };
type Intent = AssistantIntent;
type DetailRow = Record<string, unknown>;
type DbQueryResult = { data?: unknown[] | null; error?: unknown; count?: number | null };
type DbQuery = PromiseLike<DbQueryResult> & {
  eq(column: string, value: unknown): DbQuery;
  gte(column: string, value: unknown): DbQuery;
  lt(column: string, value: unknown): DbQuery;
  in(column: string, values: readonly unknown[]): DbQuery;
  order(column: string, options?: { ascending?: boolean }): DbQuery;
  limit(count: number): DbQuery;
  select(columns?: string): DbQuery;
  single(): PromiseLike<{ data?: Record<string, unknown> | null; error?: unknown }>;
};
type DbAdmin = {
  from(table: string): {
    select(columns?: string, options?: Record<string, unknown>): DbQuery;
    insert(values: unknown): DbQuery;
    update(values: unknown): DbQuery;
    delete(): DbQuery;
  };
};
type LlmResult = {
  answer: string;
  mode: string;
  model: string;
  status: "live" | "fallback";
  provider?: "openai" | "internal";
  fallbackReason?: string;
  error?: string;
  /** Usulan aksi tulis yang menunggu konfirmasi user (EPIC-017 Fase E). */
  pendingAction?: PendingActionMeta | null;
};
type Summary = {
  generatedAt: string;
  hris: Record<string, number>;
  performance: Record<string, number>;
  payroll: Record<string, number>;
  procurement: Record<string, number>;
  pos: Record<string, number>;
  inventory: Record<string, number>;
  master: Record<string, number>;
  integration: Record<string, number>;
  modules: Record<string, { label: string; metrics: Record<string, number> }>;
  details: Partial<Record<Intent, DetailRow[]>>;
};

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
      : "Do belum bisa menghubungi tingkat yang dipilih saat ini. Coba lagi sebentar atau pilih tingkat lain di BCD Coffee OS Settings.";

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

/** Lampiran yang sudah divalidasi & dibatasi, siap masuk prompt. */
type SafeAttachment = { name: string; text: string; truncated: boolean };

/**
 * Isi lampiran datang dari klien (hasil endpoint ekstraksi), jadi tetap
 * dibatasi di sini: jumlah file, panjang per file, dan total gabungan. Tanpa
 * batas ini satu permintaan bisa membengkak tak terkendali.
 */
const MAX_ATTACHMENTS = 5;
const MAX_ATTACHMENT_TEXT = 20_000;
const MAX_ATTACHMENT_TOTAL = 40_000;

function sanitizeAttachments(input: unknown): SafeAttachment[] {
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

/** Penyimpanan pesan + log markdown + audit, dipakai jalur stream & non-stream. */
async function persistAndAudit({
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

/** Log ukuran konteks: bukti penghematan Fase C, bukan klaim. */
function logContextSaving(summary: Summary, intent: Intent) {
  const before = contextSizeChars(summary);
  const after = contextSizeChars(selectContextForIntent(summary, intent));
  const saved = before === 0 ? 0 : Math.round(((before - after) / before) * 100);
  console.info(`[do:context] intent=${intent} ${before} -> ${after} char (hemat ${saved}%)`);
}

function detectIntent(message: string): Intent {
  const lower = message.toLowerCase();
  if (lower.includes("kpi") || lower.includes("performance") || lower.includes("review") || lower.includes("penilaian")) return "performance";
  if (lower.includes("payroll") || lower.includes("gaji") || lower.includes("salary") || lower.includes("benefit") || lower.includes("loan")) return "payroll";
  if (lower.includes("integration") || lower.includes("integrasi") || lower.includes("webhook") || lower.includes("api") || lower.includes("ai assistant")) return "integration";
  if (lower.includes("master") || lower.includes("department") || lower.includes("departemen") || lower.includes("position") || lower.includes("jabatan")) return "master";
  if (lower.includes("hr") || lower.includes("kandidat") || lower.includes("candidate") || lower.includes("employee") || lower.includes("karyawan") || lower.includes("attendance") || lower.includes("absen") || lower.includes("leave") || lower.includes("cuti")) return "hris";
  if (lower.includes("procurement") || lower.includes("purchasing") || lower.includes("po") || lower.includes("pr") || lower.includes("supplier")) return "procurement";
  if (lower.includes("pos") || lower.includes("sales") || lower.includes("order") || lower.includes("reservasi")) return "pos";
  if (lower.includes("stock") || lower.includes("stok") || lower.includes("inventory") || lower.includes("bahan")) return "inventory";
  return "all";
}

function compactChatHistory(history: ChatMessage[]): ChatMessage[] {
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

async function safeCount(
  admin: DbAdmin,
  table: string,
  filter?: (query: DbQuery) => DbQuery,
): Promise<number> {
  try {
    let query = admin.from(table).select("id", { count: "exact", head: true }) as unknown as DbQuery;
    if (filter) query = filter(query);
    const { count, error } = await query;
    if (error) return 0;
    return count ?? 0;
  } catch {
    return 0;
  }
}

async function safeRows(
  admin: DbAdmin,
  table: string,
  columns: string,
  options?: {
    filter?: (query: DbQuery) => DbQuery;
    order?: { column: string; ascending?: boolean };
    limit?: number;
  },
): Promise<DetailRow[]> {
  try {
    let query = admin.from(table).select(columns) as unknown as DbQuery;
    if (options?.filter) query = options.filter(query);
    if (options?.order) query = query.order(options.order.column, { ascending: options.order.ascending ?? false });
    if (options?.limit) query = query.limit(options.limit);
    const { data, error } = await query;
    if (error || !data) return [];
    return data as DetailRow[];
  } catch {
    return [];
  }
}

async function buildSystemSummary(admin: DbAdmin, intent: Intent): Promise<Summary> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayIso = today.toISOString();

  const [
    candidatesTotal,
    candidatesToday,
    candidatesNew,
    employeesTotal,
    attendanceToday,
    leavesTotal,
    jobOpeningsTotal,
    performanceReviewsTotal,
    employeeKpisTotal,
    kpiTemplatesTotal,
    developmentPlansTotal,
    payrollRunsTotal,
    payrollDetailsTotal,
    employeeSalaryTotal,
    benefitsTotal,
    loansTotal,
    purchaseRequestsTotal,
    purchaseOrdersTotal,
    purchaseOrdersPending,
    suppliersTotal,
    rawMaterialsTotal,
    inventoryItems,
    lowStockItems,
    inventoryMovementsTotal,
    productsTotal,
    posOrdersTotal,
    posReservationsTotal,
    posCustomersTotal,
    posShiftsTotal,
    departmentsTotal,
    positionsTotal,
    employmentStatusesTotal,
    usersTotal,
    notificationsTotal,
    aiAssistantLogsTotal,
  ] = await Promise.all([
    safeCount(admin, "candidates"),
    safeCount(admin, "candidates", (q) => q.gte("created_at", todayIso)),
    safeCount(admin, "candidates", (q) => q.eq("status", "applied")),
    safeCount(admin, "employees"),
    safeCount(admin, "attendance", (q) => q.gte("created_at", todayIso)),
    safeCount(admin, "leaves"),
    safeCount(admin, "job_openings"),
    safeCount(admin, "performance_reviews"),
    safeCount(admin, "employee_kpis"),
    safeCount(admin, "kpi_templates"),
    safeCount(admin, "development_plans"),
    safeCount(admin, "payroll_runs"),
    safeCount(admin, "payroll_details"),
    safeCount(admin, "employee_salary"),
    safeCount(admin, "benefits"),
    safeCount(admin, "loans"),
    safeCount(admin, "purchase_requests"),
    safeCount(admin, "purchase_orders"),
    safeCount(admin, "purchase_orders", (q) => q.in("status", ["draft", "pending", "pending_approval", "sent", "pending_head", "pending_finance", "pending_direksi"])),
    safeCount(admin, "suppliers"),
    safeCount(admin, "raw_materials"),
    safeCount(admin, "inventory"),
    safeCount(admin, "inventory", (q) => q.lt("current_stock", 1)),
    safeCount(admin, "inventory_movements"),
    safeCount(admin, "products"),
    safeCount(admin, "pos_orders"),
    safeCount(admin, "pos_reservations"),
    safeCount(admin, "pos_customers"),
    safeCount(admin, "pos_shifts"),
    safeCount(admin, "departments"),
    safeCount(admin, "positions"),
    safeCount(admin, "employment_statuses"),
    safeCount(admin, "users"),
    safeCount(admin, "notifications"),
    safeCount(admin, "ai_assistant_logs"),
  ]);

  const details: Summary["details"] = {};
  if (intent === "all" || intent === "hris") {
    details.hris = await safeRows(admin, "candidates", "id, full_name, status, source, created_at", {
      order: { column: "created_at", ascending: false },
      limit: 5,
    });
  }
  if (intent === "all" || intent === "performance") {
    details.performance = await safeRows(admin, "performance_reviews", "id, period_label, status, grand_total_score, created_at", {
      order: { column: "created_at", ascending: false },
      limit: 5,
    });
  }
  if (intent === "all" || intent === "payroll") {
    details.payroll = await safeRows(admin, "payroll_runs", "id, period_start, period_end, status, created_at", {
      order: { column: "created_at", ascending: false },
      limit: 5,
    });
  }
  if (intent === "all" || intent === "procurement") {
    details.procurement = await safeRows(admin, "purchase_orders", "id, po_number, status, total_amount, created_at", {
      filter: (q) => q.in("status", ["draft", "pending", "pending_approval", "sent", "pending_head", "pending_finance", "pending_direksi"]),
      order: { column: "created_at", ascending: false },
      limit: 5,
    });
  }
  if (intent === "all" || intent === "inventory") {
    details.inventory = await safeRows(admin, "inventory", "id, current_stock, minimum_stock, raw_material_id, updated_at", {
      filter: (q) => q.lt("current_stock", 1),
      order: { column: "updated_at", ascending: false },
      limit: 5,
    });
  }
  if (intent === "all" || intent === "pos") {
    details.pos = await safeRows(admin, "pos_orders", "id, order_number, status, total_amount, created_at", {
      order: { column: "created_at", ascending: false },
      limit: 5,
    });
  }
  if (intent === "all" || intent === "integration") {
    details.integration = await safeRows(admin, "ai_assistant_logs", "id, user_email, intent, model, latency_ms, created_at", {
      order: { column: "created_at", ascending: false },
      limit: 5,
    });
  }
  if (intent === "all" || intent === "master") {
    details.master = await safeRows(admin, "departments", "id, name, created_at", {
      order: { column: "created_at", ascending: false },
      limit: 5,
    });
  }

  const hris = { candidatesTotal, candidatesToday, candidatesNew, employeesTotal, attendanceToday, leavesTotal, jobOpeningsTotal };
  const performance = { performanceReviewsTotal, employeeKpisTotal, kpiTemplatesTotal, developmentPlansTotal };
  const payroll = { payrollRunsTotal, payrollDetailsTotal, employeeSalaryTotal, benefitsTotal, loansTotal };
  const procurement = { purchaseRequestsTotal, purchaseOrdersTotal, purchaseOrdersPending, suppliersTotal, rawMaterialsTotal };
  const inventory = { inventoryItems, lowStockItems, inventoryMovementsTotal, productsTotal };
  const pos = { posOrdersTotal, posReservationsTotal, posCustomersTotal, posShiftsTotal };
  const master = { departmentsTotal, positionsTotal, employmentStatusesTotal, usersTotal };
  const integration = { notificationsTotal, aiAssistantLogsTotal };

  return {
    generatedAt: new Date().toISOString(),
    hris,
    performance,
    payroll,
    procurement,
    pos,
    inventory,
    master,
    integration,
    modules: {
      hris: { label: "HRIS", metrics: hris },
      performance: { label: "Performance", metrics: performance },
      payroll: { label: "Payroll", metrics: payroll },
      procurement: { label: "Procurement", metrics: procurement },
      inventory: { label: "Inventory", metrics: inventory },
      pos: { label: "POS", metrics: pos },
      master: { label: "Master Data", metrics: master },
      integration: { label: "Integration", metrics: integration },
    },
    details,
  };
}

function createEmptySystemSummary(): Summary {
  const empty: Record<string, number> = {};
  return {
    generatedAt: new Date().toISOString(),
    hris: empty,
    performance: empty,
    payroll: empty,
    procurement: empty,
    pos: empty,
    inventory: empty,
    master: empty,
    integration: empty,
    modules: {},
    details: {},
  };
}

/**
 * Panggil OpenAI Chat Completions untuk model berprefix `openai:`.
 *
 * Sumber kredensial: setting `openai_api_key` di database (Settings → Integrasi)
 * SELALU didahulukan, sama seperti seluruh integrasi lain di aplikasi ini.
 * Env `OPENAI_API_KEY` hanya dipakai bila setting itu kosong.
 *
 * Urutannya dulu terbalik dan itu menimbulkan bug yang sulit dilihat: shell
 * server mengekspor `OPENAI_API_KEY` lama di ~/.bashrc, PM2 mewarisinya, dan
 * aplikasi memakai key mati itu (429 insufficient_quota) meskipun key yang benar
 * sudah tersimpan rapi lewat UI. Key yang diatur dari dashboard harus menang —
 * itu satu-satunya yang bisa dilihat dan diganti oleh admin.
 */
type OpenAiCall = { apiKey: string; baseUrl: string; timeoutMs: number };

async function resolveOpenAiCall(): Promise<OpenAiCall> {
  const s = await getSettings([SETTING_KEYS.OPENAI_API_KEY, SETTING_KEYS.OPENAI_BASE_URL]);
  const apiKey = s[SETTING_KEYS.OPENAI_API_KEY] || process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "API key OpenAI belum tersedia (env OPENAI_API_KEY maupun Settings → Integrasi kosong)"
    );
  }
  return {
    apiKey,
    baseUrl: (s[SETTING_KEYS.OPENAI_BASE_URL] || "https://api.openai.com/v1").replace(/\/$/, ""),
    timeoutMs: Number(process.env.OPENAI_TIMEOUT || "120000"),
  };
}

function buildChatBody(model: string, messages: ChatMsg[], stream: boolean) {
  return JSON.stringify({
    model: stripOpenAiPrefix(model),
    // Sebagian model generasi baru hanya menerima temperature = 1 dan menolak
    // request dengan HTTP 400 bila field ini dikirim.
    ...(modelSupportsTemperature(model) ? { temperature: 0.7 } : {}),
    ...(stream ? { stream: true } : {}),
    messages,
  });
}

type ChatMsg = { role: string; content: string | null; tool_calls?: unknown; tool_call_id?: string; name?: string };

/**
 * Putaran tool calling (EPIC-017 Fase D).
 *
 * Dijalankan NON-stream lebih dulu: model memutuskan perlu data apa, tool-nya
 * dieksekusi di server, hasilnya dilampirkan ke percakapan. Jawaban final untuk
 * user baru dialirkan streaming — jadi user tetap melihat teks mengalir tanpa
 * kita perlu merakit tool_calls dari potongan delta yang rapuh.
 *
 * Mengembalikan daftar pesan yang sudah diperkaya hasil tool (atau apa adanya
 * bila model tidak meminta tool apa pun).
 */
async function runToolRounds(
  model: string,
  messages: ChatMsg[],
  actionCtx: { userId: string; userName: string; sessionId?: string },
  /** Alat yang boleh dipakai user ini (hasil pemetaan IAM). */
  toolAllowList: string[],
  maxRounds = 3
): Promise<{ messages: ChatMsg[]; toolsUsed: string[]; pendingAction: PendingActionMeta | null }> {
  const { apiKey, baseUrl, timeoutMs } = await resolveOpenAiCall();
  const working = [...messages];
  const toolsUsed: string[] = [];
  let pendingAction: PendingActionMeta | null = null;

  for (let round = 0; round < maxRounds; round++) {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: stripOpenAiPrefix(model),
        ...(modelSupportsTemperature(model) ? { temperature: 0.7 } : {}),
        // Model hanya ditawari alat yang memang boleh dipakai user ini.
        tools: [...toolDefinitions(), ...writeToolDefinitions()].filter((def) =>
          toolAllowList.includes(def.function?.name ?? "")
        ),
        messages: working,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      throw new Error(`OpenAI ${response.status}: ${(await response.text()).slice(0, 300)}`);
    }

    const json = (await response.json()) as {
      choices?: Array<{
        message?: {
          content?: string | null;
          tool_calls?: Array<{ id: string; function?: { name?: string; arguments?: string } }>;
        };
      }>;
    };
    const choice = json.choices?.[0]?.message;
    const calls = choice?.tool_calls ?? [];
    if (!calls.length) return { messages: working, toolsUsed, pendingAction };

    // Pesan asisten yang memuat tool_calls WAJIB ikut disertakan sebelum hasil
    // tool-nya; OpenAI menolak tool message yang tidak punya panggilan induk.
    working.push({ role: "assistant", content: choice?.content ?? null, tool_calls: calls });

    for (const call of calls) {
      const name = call.function?.name ?? "";
      const args = parseToolArguments(call.function?.arguments);
      let result: unknown;
      if (!toolAllowList.includes(name)) {
        // Pertahanan kedua: model bisa saja mengarang nama alat di luar daftar
        // yang ditawarkan. Eksekusi tetap ditolak di sisi server.
        result = { error: "Alat ini di luar hak akses Anda." };
      } else if (isWriteActionName(name)) {
        // Aksi tulis TIDAK dieksekusi di sini — hanya jadi usulan pending yang
        // menunggu tombol konfirmasi user di UI (EPIC-017 Fase E). Satu usulan
        // per giliran supaya kartu konfirmasi tidak menumpuk.
        if (pendingAction) {
          result = { error: "Sudah ada aksi lain yang menunggu konfirmasi user pada giliran ini." };
        } else {
          const proposal = await proposeWriteAction(name, args, actionCtx);
          if ("pending" in proposal) {
            pendingAction = proposal.pending;
            result = {
              status: "menunggu_konfirmasi_user",
              ringkasan: proposal.pending.summary,
              instruksi:
                "Aksi BELUM dijalankan. User harus menekan tombol konfirmasi pada kartu yang muncul di layar. " +
                "Sampaikan ke user untuk memeriksa kartu konfirmasi, dan JANGAN mengklaim aksi sudah dijalankan.",
            };
          } else {
            result = { error: proposal.error };
          }
        }
      } else {
        result = await runTool(name, args);
      }
      toolsUsed.push(name);
      console.info(`[do:tool] ${name} ${JSON.stringify(args)}`);
      working.push({
        role: "tool",
        tool_call_id: call.id,
        name,
        content: JSON.stringify(result),
      });
    }
  }

  // Batas putaran tercapai: lanjutkan dengan data yang sudah terkumpul daripada
  // membiarkan model memanggil tool tanpa henti.
  console.warn("[do:tool] batas putaran tool tercapai");
  return { messages: working, toolsUsed, pendingAction };
}

async function callOpenAiChat(model: string, messages: ChatMsg[]): Promise<string> {
  const { apiKey, baseUrl, timeoutMs } = await resolveOpenAiCall();
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: buildChatBody(model, messages, false),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    throw new Error(`OpenAI ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }
  const json = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const answer = normalizePlainTextAnswer(json.choices?.[0]?.message?.content);
  if (!answer) throw new Error("OpenAI mengembalikan jawaban kosong");
  return answer;
}

/**
 * Versi streaming: potongan jawaban dikirim lewat `onDelta` begitu tiba, dan
 * teks utuhnya dikembalikan setelah stream selesai (dipakai untuk disimpan &
 * diaudit persis seperti jalur non-stream).
 */
async function callOpenAiChatStream(
  model: string,
  messages: ChatMsg[],
  onDelta: (text: string) => void
): Promise<string> {
  const { apiKey, baseUrl, timeoutMs } = await resolveOpenAiCall();
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: buildChatBody(model, messages, true),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    throw new Error(`OpenAI ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }
  if (!response.body) throw new Error("OpenAI stream tanpa body");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const { events, rest } = splitSseEvents(buffer);
    buffer = rest;

    for (const event of events) {
      for (const payload of extractSseData(event)) {
        const piece = readOpenAiDelta(payload);
        if (piece) {
          full += piece;
          onDelta(piece);
        }
      }
    }
  }

  const answer = normalizePlainTextAnswer(full);
  if (!answer) throw new Error("OpenAI mengembalikan jawaban kosong");
  return answer;
}

async function generateAnswer({
  message,
  history,
  summary,
  fallbackAnswer,
  userName,
  intent,
  scope,
  model,
  attachments,
  actionCtx,
  toolAllowList,
  onDelta,
}: {
  message: string;
  history: ChatMessage[];
  summary: Summary;
  fallbackAnswer: string;
  userName: string;
  intent: Intent;
  scope: AiAssistantScope;
  model: AiAssistantModel;
  attachments?: SafeAttachment[];
  /** Identitas pemilik giliran ini — dipakai usulan aksi tulis (Fase E). */
  actionCtx: { userId: string; userName: string; sessionId?: string };
  /** Alat yang boleh dipakai user ini (dipetakan dari menu IAM). */
  toolAllowList: string[];
  /** Bila diisi, jawaban dialirkan potong demi potong lewat callback ini. */
  onDelta?: (text: string) => void;
}): Promise<LlmResult> {
  const includeProjectData = scope !== "general";
  const scopeInstruction = buildScopeInstruction(scope);

  const systemPrompt = [
    "Kamu adalah Do, asisten BCD Coffee OS untuk semua user BCD Coffee OS.",
    "Perkenalkan dirimu sebagai Do. Jangan menyebut vendor atau nama model di balik layar kecuali user bertanya langsung.",
    scopeInstruction,
    "Jawab dalam Bahasa Indonesia yang ramah, jelas, natural, dan actionable.",
    "Gunakan bahasa awam seperti asisten operasional, bukan bahasa developer.",
    "Jangan menyebut JSON, API, query, schema, database, payload, object, array, model, prompt, system, atau istilah teknis internal kecuali user secara eksplisit meminta penjelasan teknis.",
    "Jika user bertanya data bisnis BCD Coffee OS, gunakan data internal yang tersedia dan jangan mengarang angka.",
    "Kamu punya alat untuk mengambil data terkini (karyawan, absensi, stok, penjualan, kandidat). Pakai alat itu bila pertanyaannya spesifik, jangan menebak dari ringkasan.",
    "Kamu juga bisa MENYIAPKAN aksi tertentu (membuat draft pengumuman, mencatat catatan kandidat). Aksi itu tidak pernah berjalan otomatis: sistem menampilkan kartu konfirmasi dan user harus menekan tombolnya sendiri. Setelah menyiapkan aksi, minta user memeriksa kartu konfirmasi di bawah jawabanmu, dan jangan pernah mengklaim aksinya sudah dijalankan.",
    "Jika data yang diperlukan tidak tersedia, cukup katakan data tersebut belum tersedia di sistem dan sarankan module atau filter yang perlu dibuka.",
    "Jika menjawab angka atau ringkasan, jelaskan artinya dalam konteks bisnis secara singkat.",
    "Ingat konteks percakapan dari history yang diberikan.",
    "Gunakan teks polos saja. Jangan gunakan markdown untuk bold, italic, heading, blockquote, atau tabel.",
  ].join(" ");
  const userPrompt = [
    `Nama user: ${userName}`,
    `Mode konteks: ${scope}`,
    // Nama model sengaja TIDAK dikirim: dulu ikut masuk prompt dan bisa terbawa
    // ke jawaban ("saya memakai gpt-4o-mini"), padahal Do harus tampil sebagai
    // satu merek sendiri. Model juga tidak butuh tahu namanya untuk menjawab.
    `Intent terdeteksi: ${intent}`,
    `Pertanyaan user: ${message}`,
    attachments?.length
      ? `\nIsi lampiran yang dikirim user (sudah diekstrak; gambar & PDF hasil scan lewat OCR sehingga bisa ada salah baca):\n${attachments
          .map(
            (item) =>
              `--- ${item.name}${item.truncated ? " (dipotong karena panjang)" : ""} ---\n${item.text}`
          )
          .join("\n\n")}`
      : "",
    // Hanya modul yang relevan dengan intent yang dikirim — bukan seluruh
    // summary. Lihat lib/assistant/context.ts untuk alasan & pengujiannya.
    includeProjectData
      ? `\nKonteks internal BCD Coffee OS yang tersedia jika relevan:\n${JSON.stringify(selectContextForIntent(summary, intent), null, 2)}`
      : "\nKonteks operasional BCD Coffee OS tidak dikirim untuk mode General Chat.",
  ].join("\n");
  const messages = [
    { role: "system", content: systemPrompt },
    ...history.map((item) => ({ role: item.role, content: item.content })),
    { role: "user", content: userPrompt },
  ];

  // Tool calling hanya masuk akal saat konteks project dibawa; mode General Chat
  // sengaja tidak diberi akses data operasional.
  let working: ChatMsg[] = messages;
  let toolsUsed: string[] = [];
  let pendingAction: PendingActionMeta | null = null;
  if (includeProjectData) {
    try {
      const rounds = await runToolRounds(model, messages, actionCtx, toolAllowList);
      working = rounds.messages;
      toolsUsed = rounds.toolsUsed;
      pendingAction = rounds.pendingAction;
    } catch (error) {
      // Gagal di tahap tool bukan alasan gagal menjawab: lanjutkan tanpa data
      // tambahan, memakai konteks ringkasan seperti sebelumnya.
      console.warn("[do:tool] putaran tool gagal:", formatProviderError(error, "openai-tools"));
    }
  }
  const modeSuffix = toolsUsed.length ? `_tools:${[...new Set(toolsUsed)].join("+")}` : "";

  // Semua model kini dilayani OpenAI; pilihan Ollama sudah dihapus.
  if (onDelta) {
    try {
      const answer = await callOpenAiChatStream(model, working, onDelta);
      return { answer, mode: `openai_stream_live${modeSuffix}`, model, provider: "openai", status: "live", pendingAction };
    } catch (error) {
      // Streaming gagal (mis. proxy memotong koneksi) bukan alasan menyerah:
      // coba sekali lagi tanpa stream sebelum jatuh ke ringkasan internal.
      console.warn("AI assistant stream gagal, coba non-stream:", formatProviderError(error, "openai-stream"));
    }
  }

  try {
    const answer = await callOpenAiChat(model, working);
    return { answer, mode: `openai_chat_completions_live${modeSuffix}`, model, provider: "openai", status: "live", pendingAction };
  } catch (error) {
    const detail = formatProviderError(error, "openai");
    console.warn("AI assistant OpenAI fallback:", detail);
    return {
      answer: fallbackAnswer,
      mode: "openai_unavailable_fallback",
      model,
      provider: "internal",
      status: "fallback",
      fallbackReason: "Do sedang tidak bisa menjangkau layanan AI. Saya memakai ringkasan internal sementara.",
      error: detail,
    };
  }
}

function buildScopeInstruction(scope: AiAssistantScope): string {
  if (scope === "project_only") {
    return [
      "Mode Project Only aktif.",
      "Jawab hanya berdasarkan konteks Talentpool/BCD Coffee OS, history percakapan, dan data internal yang diberikan.",
      "Jika user bertanya pengetahuan umum atau hal di luar project, jelaskan singkat bahwa mode Project Only sedang aktif dan minta user mengganti mode di BCD Coffee OS Settings.",
    ].join(" ");
  }

  if (scope === "general") {
    return [
      "Mode General Chat aktif.",
      "Jawab seperti assistant umum dengan knowledge model.",
      "Jangan mengklaim sedang membaca data operasional Talentpool karena data project tidak dikirim pada mode ini.",
    ].join(" ");
  }

  return [
    "Mode Project + General aktif.",
    "Untuk pertanyaan operasional Talentpool/BCD Coffee OS, prioritaskan data internal yang diberikan.",
    "Untuk ide, strategi, copywriting, SOP, analisis, coding, dan pertanyaan umum, jawab bebas dengan knowledge model tanpa memaksa data dashboard.",
  ].join(" ");
}

function normalizePlainTextAnswer(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*\*\s+/gm, "- ")
    .replace(/^\s*>\s?/gm, "")
    .replace(/`([^`\n]+)`/g, "$1")
    .trim();
}

function formatProviderError(error: unknown, endpoint: string): string {
  if (!(error instanceof Error)) return `${endpoint}: unknown error`;
  const cause = error.cause as { code?: string; address?: string; port?: number; message?: string } | undefined;
  const causeText = cause ? ` cause=${JSON.stringify({ code: cause.code, address: cause.address, port: cause.port, message: cause.message })}` : "";
  return `${endpoint}: ${error.name}: ${error.message}${causeText}`;
}

async function loadSessionHistory(admin: DbAdmin, sessionId: string): Promise<ChatMessage[]> {
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

function generateSummaryAnswer(message: string, summary: Summary, name: string, intent: Intent): string {
  const lower = message.toLowerCase();
  const sections: string[] = [];
  const includeAll = intent === "all" || !lower || lower.includes("semua") || lower.includes("summary") || lower.includes("ringkas") || lower.includes("overview");

  if (includeAll) {
    sections.push(`Halo ${name}, berikut ringkasan BCD Coffee OS saat ini:`);
    sections.push(formatHris(summary));
    sections.push(formatPerformance(summary));
    sections.push(formatPayroll(summary));
    sections.push(formatProcurement(summary));
    sections.push(formatInventory(summary));
    sections.push(formatPos(summary));
    sections.push(formatMaster(summary));
    sections.push(formatIntegration(summary));
    sections.push(formatDetails(summary));
    sections.push("Prioritas: cek kandidat baru, review performance, PO pending, inventory low stock, dan aktivitas POS terbaru.");
    return sections.filter(Boolean).join("\n\n");
  }

  if (intent === "hris") return [formatHris(summary), formatDetails(summary, "hris")].filter(Boolean).join("\n\n");
  if (intent === "performance") return [formatPerformance(summary), formatDetails(summary, "performance")].filter(Boolean).join("\n\n");
  if (intent === "payroll") return [formatPayroll(summary), formatDetails(summary, "payroll")].filter(Boolean).join("\n\n");
  if (intent === "procurement") return [formatProcurement(summary), formatDetails(summary, "procurement")].filter(Boolean).join("\n\n");
  if (intent === "pos") return [formatPos(summary), formatDetails(summary, "pos")].filter(Boolean).join("\n\n");
  if (intent === "inventory") return [formatInventory(summary), formatDetails(summary, "inventory")].filter(Boolean).join("\n\n");
  if (intent === "master") return [formatMaster(summary), formatDetails(summary, "master")].filter(Boolean).join("\n\n");
  if (intent === "integration") return [formatIntegration(summary), formatDetails(summary, "integration")].filter(Boolean).join("\n\n");

  return [
    formatHris(summary),
    formatPerformance(summary),
    formatPayroll(summary),
    formatProcurement(summary),
    formatInventory(summary),
    formatPos(summary),
    formatMaster(summary),
    formatIntegration(summary),
  ].join("\n\n");
}

function formatHris(summary: Summary) {
  return `HRIS: ${summary.hris.candidatesTotal ?? 0} total kandidat, ${summary.hris.candidatesToday ?? 0} kandidat masuk hari ini, ${summary.hris.candidatesNew ?? 0} kandidat status new, ${summary.hris.employeesTotal ?? 0} karyawan, ${summary.hris.attendanceToday ?? 0} attendance hari ini, ${summary.hris.leavesTotal ?? 0} leave request, ${summary.hris.jobOpeningsTotal ?? 0} job opening.`;
}

function formatPerformance(summary: Summary) {
  return `Performance: ${summary.performance.performanceReviewsTotal ?? 0} review, ${summary.performance.employeeKpisTotal ?? 0} employee KPI, ${summary.performance.kpiTemplatesTotal ?? 0} template KPI, ${summary.performance.developmentPlansTotal ?? 0} development plan.`;
}

function formatPayroll(summary: Summary) {
  return `Payroll: ${summary.payroll.payrollRunsTotal ?? 0} payroll run, ${summary.payroll.payrollDetailsTotal ?? 0} payroll detail, ${summary.payroll.employeeSalaryTotal ?? 0} salary record, ${summary.payroll.benefitsTotal ?? 0} benefit, ${summary.payroll.loansTotal ?? 0} loan.`;
}

function formatProcurement(summary: Summary) {
  return `Procurement: ${summary.procurement.purchaseRequestsTotal ?? 0} PR, ${summary.procurement.purchaseOrdersTotal ?? 0} PO, ${summary.procurement.purchaseOrdersPending ?? 0} PO perlu perhatian, ${summary.procurement.suppliersTotal ?? 0} supplier, ${summary.procurement.rawMaterialsTotal ?? 0} raw material.`;
}

function formatPos(summary: Summary) {
  return `POS: ${summary.pos.posOrdersTotal ?? 0} order, ${summary.pos.posReservationsTotal ?? 0} reservasi, ${summary.pos.posCustomersTotal ?? 0} customer, ${summary.pos.posShiftsTotal ?? 0} shift.`;
}

function formatInventory(summary: Summary) {
  return `Inventory: ${summary.inventory.inventoryItems ?? 0} item inventory, ${summary.inventory.lowStockItems ?? 0} item low/empty stock, ${summary.inventory.inventoryMovementsTotal ?? 0} movement, ${summary.inventory.productsTotal ?? 0} product.`;
}

function formatMaster(summary: Summary) {
  return `Master Data: ${summary.master.departmentsTotal ?? 0} department, ${summary.master.positionsTotal ?? 0} position, ${summary.master.employmentStatusesTotal ?? 0} employment status, ${summary.master.usersTotal ?? 0} user.`;
}

function formatIntegration(summary: Summary) {
  return `Integration: ${summary.integration.notificationsTotal ?? 0} notification, ${summary.integration.aiAssistantLogsTotal ?? 0} AI assistant log.`;
}

function formatDetails(summary: Summary, only?: Intent) {
  const lines: string[] = [];
  const add = (label: string, rows?: DetailRow[]) => {
    if (!rows?.length) return;
    lines.push(`${label}: ${rows.slice(0, 5).map((row) => Object.values(row).filter(Boolean).slice(0, 4).join(" | ")).join("; ")}`);
  };
  if (!only || only === "hris") add("Kandidat terbaru", summary.details.hris);
  if (!only || only === "performance") add("Performance review terbaru", summary.details.performance);
  if (!only || only === "payroll") add("Payroll run terbaru", summary.details.payroll);
  if (!only || only === "procurement") add("PO pending terbaru", summary.details.procurement);
  if (!only || only === "inventory") add("Inventory low stock", summary.details.inventory);
  if (!only || only === "pos") add("POS order terbaru", summary.details.pos);
  if (!only || only === "master") add("Master data terbaru", summary.details.master);
  if (!only || only === "integration") add("AI assistant activity", summary.details.integration);
  return lines.join("\n");
}
