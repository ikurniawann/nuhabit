import {
  type AiAssistantModel,
  type AiAssistantScope,
  modelSupportsTemperature,
  stripOpenAiPrefix,
} from "@/lib/ai-assistant-config";
import { SETTING_KEYS, getSettings } from "@/lib/settings/app-settings";
import { extractSseData, readOpenAiDelta, splitSseEvents } from "@/lib/assistant/sse";
import { selectContextForIntent, type AssistantIntent } from "@/lib/assistant/context";
import { parseToolArguments, runTool, toolDefinitions } from "@/lib/assistant/tools";
import {
  isWriteActionName,
  proposeWriteAction,
  writeToolDefinitions,
  type PendingActionMeta,
} from "@/lib/assistant/write-tools";
import type { SafeAttachment } from "@/lib/assistant/session-store";
import type { Summary } from "@/lib/assistant/summary";

type Intent = AssistantIntent;
export type ChatMessage = { role: "user" | "assistant"; content: string };
export type LlmResult = {
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

export async function generateAnswer({
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
    "Kamu adalah Do, asisten NüHabit OS untuk semua user NüHabit OS.",
    "Perkenalkan dirimu sebagai Do. Jangan menyebut vendor atau nama model di balik layar kecuali user bertanya langsung.",
    scopeInstruction,
    "Jawab dalam Bahasa Indonesia yang ramah, jelas, natural, dan actionable.",
    "Gunakan bahasa awam seperti asisten operasional, bukan bahasa developer.",
    "Jangan menyebut JSON, API, query, schema, database, payload, object, array, model, prompt, system, atau istilah teknis internal kecuali user secara eksplisit meminta penjelasan teknis.",
    "Jika user bertanya data bisnis NüHabit OS, gunakan data internal yang tersedia dan jangan mengarang angka.",
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
      ? `\nKonteks internal NüHabit OS yang tersedia jika relevan:\n${JSON.stringify(selectContextForIntent(summary, intent), null, 2)}`
      : "\nKonteks operasional NüHabit OS tidak dikirim untuk mode General Chat.",
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

export function buildScopeInstruction(scope: AiAssistantScope): string {
  if (scope === "project_only") {
    return [
      "Mode Project Only aktif.",
      "Jawab hanya berdasarkan konteks Talentpool/NüHabit OS, history percakapan, dan data internal yang diberikan.",
      "Jika user bertanya pengetahuan umum atau hal di luar project, jelaskan singkat bahwa mode Project Only sedang aktif dan minta user mengganti mode di NüHabit OS Settings.",
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
    "Untuk pertanyaan operasional Talentpool/NüHabit OS, prioritaskan data internal yang diberikan.",
    "Untuk ide, strategi, copywriting, SOP, analisis, coding, dan pertanyaan umum, jawab bebas dengan knowledge model tanpa memaksa data dashboard.",
  ].join(" ");
}

export function normalizePlainTextAnswer(value: unknown): string {
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
