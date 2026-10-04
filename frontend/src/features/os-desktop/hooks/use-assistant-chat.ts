"use client";

import { useReducer, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { AI_ASSISTANT_MODELS, AI_ASSISTANT_SCOPES, type AiAssistantSettings } from "@/lib/ai-assistant-config";
import { STORAGE_KEYS, readStorage, removeStorage, writeStorage } from "@/lib/storage-keys";
import {
  INITIAL_CHAT_STATE,
  chatReducer,
  lastUserMessage,
  liveNote,
  statusNote,
  userMessageLabel,
  type AssistantAttachment,
  type AssistantMessage,
} from "../lib/assistant-chat";
import {
  decidePendingAction,
  fetchSessionMessages,
  postAssistantMessage,
  readAssistantStream,
  uploadAttachment,
  type AssistantReply,
} from "./assistant-api";
import { useAssistantSessions } from "./use-assistant-sessions";

const MAX_ATTACHMENTS = 5;

export type AssistantChat = ReturnType<typeof useAssistantChat>;

/**
 * Percakapan Do: kirim pesan (streaming SSE), sesi tersimpan, lampiran, dan
 * konfirmasi aksi tulis. Dimiliki desktop (bukan jendelanya) supaya "Tanya Do"
 * dari widget atau bilah ⌘⇧A bisa langsung mengirim dari event handler,
 * dan percakapan tidak hilang saat jendela ditutup.
 */
export function useAssistantChat({
  settings,
  isAllowed,
  windowOpen,
}: {
  settings: AiAssistantSettings;
  isAllowed: boolean;
  /** Daftar sesi hanya dimuat saat jendela Do terbuka. */
  windowOpen: boolean;
}) {
  const [state, dispatch] = useReducer(chatReducer, INITIAL_CHAT_STATE);
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<AssistantAttachment[]>([]);
  const sessions = useAssistantSessions(isAllowed && windowOpen);
  /** Naik setiap user bertindak; pemulihan sesi yang datang belakangan diabaikan. */
  const activity = useRef(0);
  const scope = AI_ASSISTANT_SCOPES.find((item) => item.id === settings.scope) ?? AI_ASSISTANT_SCOPES[0];
  const model = AI_ASSISTANT_MODELS.find((item) => item.id === settings.model) ?? AI_ASSISTANT_MODELS[0];

  const rememberSession = (id: string | null) => {
    if (id) writeStorage(STORAGE_KEYS.aiSession, id);
    else removeStorage(STORAGE_KEYS.aiSession);
  };

  const showSession = async (id: string, expected: number) => {
    const messages = await fetchSessionMessages(id);
    if (activity.current !== expected) return;
    dispatch({ type: "session-loaded", messages, modelId: model.id, modelLabel: model.label });
  };

  /** Buka jendela tanpa prompt: lanjutkan sesi terakhir bila percakapan masih kosong. */
  const restoreLastSession = () => {
    if (!isAllowed || state.sessionId || state.messages.length > 0) return;
    const saved = readStorage(STORAGE_KEYS.aiSession);
    if (!saved) return;
    const expected = activity.current;
    void fetchSessionMessages(saved)
      .then((messages) => {
        if (activity.current !== expected || messages.length === 0) return;
        dispatch({ type: "select-session", id: saved });
        dispatch({ type: "session-loaded", messages, modelId: model.id, modelLabel: model.label });
      })
      .catch(() => {});
  };

  const upload = useMutation({
    retry: false,
    mutationFn: async (files: File[]) => {
      for (const file of files.slice(0, MAX_ATTACHMENTS)) {
        const attachment = await uploadAttachment(file);
        setAttachments((prev) => [...prev.slice(-(MAX_ATTACHMENTS - 1)), attachment]);
      }
    },
  });

  /** Minta jawaban untuk pesan user yang sudah tampil di percakapan. */
  const requestReply = async (request: {
    message: string;
    history: AssistantMessage[];
    attachments: AssistantAttachment[];
    sessionId: string | null;
  }) => {
    const applyResult = (reply: AssistantReply) => {
      if (reply.session_id) rememberSession(reply.session_id);
      const live = reply.meta?.status === "live";
      dispatch({
        type: "result",
        sessionId: reply.session_id,
        live,
        note: live ? liveNote(model.label) : (reply.meta?.fallbackReason ?? "Fallback aktif"),
      });
    };

    try {
      const response = await postAssistantMessage({
        message: request.message,
        history: request.history,
        session_id: request.sessionId,
        model: settings.model,
        scope: settings.scope,
        attachments: request.attachments.map((item) => ({ name: item.name, text: item.text })),
      });

      if (!response.headers.get("content-type")?.includes("text/event-stream") || !response.body) {
        // Server menjawab sekali-jadi (jalur lama atau proxy menolak SSE).
        const json = (await response.json()) as AssistantReply;
        applyResult(json);
        dispatch({ type: "upsert-reply", message: { role: "assistant", content: json.answer ?? "", meta: json.meta }, replaceLast: false });
        return;
      }

      // Placeholder kosong yang isinya tumbuh seiring token berdatangan.
      let streamed = "";
      let placeholderAdded = false;
      await readAssistantStream(response.body, {
        onDelta: (piece) => {
          streamed += piece;
          dispatch({ type: "upsert-reply", message: { role: "assistant", content: streamed }, replaceLast: placeholderAdded });
          placeholderAdded = true;
        },
        onDone: (reply) => {
          applyResult(reply);
          // Teks final dari server dipakai apa adanya: rakitan klien bisa
          // berbeda bila ada event yang terlewat.
          dispatch({
            type: "upsert-reply",
            message: { role: "assistant", content: reply.answer ?? streamed, meta: reply.meta },
            replaceLast: placeholderAdded,
          });
          placeholderAdded = true;
        },
      });
    } catch (error) {
      dispatch({ type: "failed", message: error instanceof Error ? error.message : "Terjadi kesalahan." });
    } finally {
      dispatch({ type: "settled" });
      sessions.refresh();
    }
  };

  /** `fresh`: mulai percakapan baru (pertanyaan dari luar jendela Do). */
  const sendMessage = (text = input, { fresh = false } = {}) => {
    const message = text.trim();
    if (!isAllowed || !message || state.loading) return;
    activity.current += 1;
    if (fresh) dispatch({ type: "reset" });
    // Lampiran ikut pesan ini saja, lalu dikosongkan: pertanyaan berikutnya
    // tidak diam-diam membawa dokumen lama.
    const sent = fresh ? [] : attachments;
    dispatch({ type: "send", label: userMessageLabel(message, sent) });
    setInput("");
    setAttachments([]);
    upload.reset();
    void requestReply({
      message,
      history: fresh ? [] : state.messages.slice(-8),
      attachments: sent,
      sessionId: fresh ? null : state.sessionId,
    });
  };

  const decide = useMutation({
    retry: false,
    mutationFn: ({ actionId, decision }: { index: number; actionId: string; decision: "confirm" | "cancel" }) =>
      decidePendingAction(actionId, decision),
    onSuccess: (result, { index }) => dispatch({ type: "action-decided", index, status: result.status, note: result.note }),
    // Jaringan putus: biarkan tetap pending supaya user bisa mencoba lagi.
    onError: (_error, { index }) => dispatch({ type: "action-decided", index, note: "Jaringan bermasalah, coba lagi." }),
  });

  /** Buang jawaban terakhir lalu kirim ulang pertanyaan yang sama. */
  const regenerate = () => {
    if (state.loading) return;
    const lastUser = lastUserMessage(state.messages);
    if (!lastUser) return;
    dispatch({ type: "regenerate", lastUser });
    sendMessage(lastUser.content);
  };

  const deleteSession = (id: string) => {
    sessions.remove.mutate(id, {
      onSuccess: () => {
        if (state.sessionId === id) rememberSession(null);
        dispatch({ type: "session-deleted", id });
      },
      onError: (error) => dispatch({ type: "note", note: error.message || "Gagal menghapus session" }),
    });
  };

  const loadSession = (id: string) => {
    activity.current += 1;
    dispatch({ type: "select-session", id });
    rememberSession(id);
    void showSession(id, activity.current).catch(() => {});
  };

  return {
    ...state,
    model,
    scope,
    statusNote: statusNote(state, model.label),
    input,
    setInput,
    attachments,
    removeAttachment: (index: number) => setAttachments((prev) => prev.filter((_, i) => i !== index)),
    attach: (files: FileList | null) => {
      if (files && files.length > 0) upload.mutate(Array.from(files));
    },
    uploading: upload.isPending,
    uploadError: upload.error ? upload.error.message || "Gagal membaca lampiran" : null,
    sessions: sessions.sessions,
    renameSession: (id: string, title: string) => sessions.rename.mutate({ id, title }),
    deleteSession,
    loadSession,
    restoreLastSession,
    newChat: () => {
      activity.current += 1;
      rememberSession(null);
      dispatch({ type: "new-chat", greeting: `Halo, saya Do. Mode aktif: ${scope.label}. Tingkat: ${model.label}.` });
    },
    showLanding: () => {
      dispatch({ type: "landing" });
      sessions.refresh();
    },
    sendMessage,
    regenerate,
    decideAction: (index: number, actionId: string, decision: "confirm" | "cancel") => decide.mutate({ index, actionId, decision }),
    actionBusyId: decide.isPending ? (decide.variables?.actionId ?? null) : null,
  };
}
