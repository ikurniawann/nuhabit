/**
 * State percakapan Do sebagai reducer murni: pesan, sesi aktif, tampilan
 * (landing/chat), indikator memproses, dan status koneksi model.
 */

/** Usulan aksi tulis Do yang menunggu tombol konfirmasi (EPIC-017 Fase E). */
export type PendingAction = {
  id: string;
  name: string;
  summary: string;
  status: "pending" | "confirmed" | "cancelled" | "expired" | "failed";
  result_note?: string;
};

export type AssistantMeta = {
  status?: string;
  model?: string;
  scope?: string;
  fallbackReason?: string;
  pending_action?: PendingAction;
};

export type AssistantMessage = {
  role: "user" | "assistant";
  content: string;
  meta?: AssistantMeta;
};

export type AssistantAttachment = { name: string; text: string; method: string; truncated: boolean; chars: number };

export type AssistantSession = { id: string; title: string; updated_at: string };

export type ConnectionStatus = "ready" | "live" | "fallback";

export interface ChatState {
  messages: AssistantMessage[];
  sessionId: string | null;
  view: "landing" | "chat";
  loading: boolean;
  status: ConnectionStatus;
  /** null = catatan "siap" bawaan yang mengikuti label model aktif. */
  note: string | null;
}

export const INITIAL_CHAT_STATE: ChatState = {
  messages: [],
  sessionId: null,
  view: "landing",
  loading: false,
  status: "ready",
  note: null,
};

export const EMPTY_SESSION_NOTE = "Do siap. Kirim pesan untuk mulai.";

export function readyNote(modelLabel: string): string {
  return `Do siap · ${modelLabel}`;
}

export function liveNote(modelLabel: string): string {
  return `Live: ${modelLabel}`;
}

export function statusNote(state: ChatState, modelLabel: string): string {
  return state.note ?? readyNote(modelLabel);
}

export type ChatAction =
  | { type: "reset" }
  | { type: "landing" }
  | { type: "new-chat"; greeting: string }
  | { type: "select-session"; id: string }
  | { type: "session-loaded"; messages: AssistantMessage[]; modelId: string; modelLabel: string }
  | { type: "session-deleted"; id: string }
  | { type: "note"; note: string }
  | { type: "send"; label: string }
  | { type: "upsert-reply"; message: AssistantMessage; replaceLast: boolean }
  | { type: "result"; sessionId?: string; live: boolean; note: string }
  | { type: "failed"; message: string }
  | { type: "settled" }
  | { type: "action-decided"; index: number; status?: PendingAction["status"]; note: string }
  | { type: "regenerate"; lastUser: AssistantMessage };

/** Pesan dari server: hanya giliran user/asisten yang ditampilkan. */
export function mapSessionMessages(raw: unknown): AssistantMessage[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((m: { role?: string }) => m?.role === "user" || m?.role === "assistant")
    .map((m: AssistantMessage) => ({ role: m.role, content: m.content, meta: m.meta }));
}

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "reset":
      return INITIAL_CHAT_STATE;
    case "landing":
      return { ...state, view: "landing" };
    case "new-chat":
      return {
        ...state,
        sessionId: null,
        messages: [{ role: "assistant", content: action.greeting }],
        status: "ready",
        note: null,
        view: "chat",
      };
    case "select-session":
      return { ...state, sessionId: action.id };
    case "session-loaded": {
      if (action.messages.length === 0) {
        return { ...state, messages: [], status: "ready", note: EMPTY_SESSION_NOTE, view: "chat" };
      }
      const lastMeta = action.messages.filter((m) => m.role === "assistant").at(-1)?.meta;
      const live = lastMeta?.status === "live" && lastMeta.model === action.modelId;
      return {
        ...state,
        messages: action.messages,
        status: live ? "live" : "ready",
        note: live ? liveNote(action.modelLabel) : null,
        view: "chat",
      };
    }
    case "session-deleted":
      if (state.sessionId !== action.id) return state;
      return { ...state, sessionId: null, messages: [], status: "ready", note: null, view: "landing" };
    case "note":
      return { ...state, note: action.note };
    case "send":
      return { ...state, messages: [...state.messages, { role: "user", content: action.label }], loading: true, view: "chat" };
    case "upsert-reply": {
      const messages = [...state.messages];
      if (action.replaceLast) messages[messages.length - 1] = action.message;
      else messages.push(action.message);
      // Token pertama sudah tiba: sembunyikan indikator "Memproses...".
      return { ...state, messages, loading: false };
    }
    case "result":
      return {
        ...state,
        sessionId: action.sessionId ?? state.sessionId,
        status: action.live ? "live" : "fallback",
        note: action.note,
      };
    case "failed":
      return {
        ...state,
        messages: [...state.messages, { role: "assistant", content: action.message }],
        loading: false,
      };
    case "settled":
      return { ...state, loading: false };
    case "action-decided":
      return {
        ...state,
        messages: state.messages.map((m, i) => {
          if (i !== action.index || !m.meta?.pending_action) return m;
          const pending = m.meta.pending_action;
          return {
            ...m,
            meta: {
              ...m.meta,
              pending_action: { ...pending, status: action.status ?? pending.status, result_note: action.note },
            },
          };
        }),
      };
    case "regenerate": {
      // Jawaban lama dibuang supaya tidak ada dua jawaban berdampingan;
      // riwayat di server tetap utuh sebagai jejak.
      const messages = [...state.messages];
      while (messages.length && messages[messages.length - 1].role === "assistant") messages.pop();
      return { ...state, messages: messages.filter((m) => m !== action.lastUser) };
    }
  }
}

/** Isi lampiran ikut di label pesan user supaya terlihat di riwayat. */
export function userMessageLabel(message: string, attachments: AssistantAttachment[]): string {
  return attachments.length ? `${message}\n\n[Lampiran: ${attachments.map((a) => a.name).join(", ")}]` : message;
}

export function lastUserMessage(messages: AssistantMessage[]): AssistantMessage | undefined {
  return [...messages].reverse().find((m) => m.role === "user");
}

/** Jawaban model ditampilkan sebagai teks polos (markdown ringan dibuang). */
export function formatPlainChatText(value: string): string {
  return value
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*\*\s+/gm, "- ")
    .replace(/^\s*>\s?/gm, "")
    .replace(/`([^`\n]+)`/g, "$1")
    .trim();
}

export function pendingActionOutcome(action: PendingAction): string {
  if (action.result_note) return action.result_note;
  switch (action.status) {
    case "confirmed":
      return "Aksi sudah dijalankan.";
    case "cancelled":
      return "Aksi dibatalkan.";
    case "expired":
      return "Aksi kedaluwarsa tanpa dikonfirmasi.";
    default:
      return "Aksi gagal dijalankan.";
  }
}
