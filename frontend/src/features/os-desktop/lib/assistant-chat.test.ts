import { describe, expect, it } from "vitest";
import {
  EMPTY_SESSION_NOTE,
  INITIAL_CHAT_STATE,
  chatReducer,
  formatPlainChatText,
  lastUserMessage,
  mapSessionMessages,
  pendingActionOutcome,
  statusNote,
  userMessageLabel,
  type AssistantMessage,
  type ChatState,
} from "./assistant-chat";

const user = (content: string): AssistantMessage => ({ role: "user", content });
const bot = (content: string, meta?: AssistantMessage["meta"]): AssistantMessage => ({ role: "assistant", content, meta });

describe("chatReducer", () => {
  it("send menambah pesan user, menyalakan loading, dan pindah ke chat", () => {
    const next = chatReducer(INITIAL_CHAT_STATE, { type: "send", label: "Halo" });
    expect(next.messages).toEqual([user("Halo")]);
    expect(next.loading).toBe(true);
    expect(next.view).toBe("chat");
  });

  it("streaming: placeholder ditambah sekali lalu diganti", () => {
    let state = chatReducer(INITIAL_CHAT_STATE, { type: "send", label: "Q" });
    state = chatReducer(state, { type: "upsert-reply", message: bot("Ha"), replaceLast: false });
    expect(state.loading).toBe(false);
    state = chatReducer(state, { type: "upsert-reply", message: bot("Halo"), replaceLast: true });
    expect(state.messages).toEqual([user("Q"), bot("Halo")]);
  });

  it("result menyimpan sesi dan status live/fallback", () => {
    const live = chatReducer(INITIAL_CHAT_STATE, { type: "result", sessionId: "s1", live: true, note: "Live: X" });
    expect(live).toMatchObject({ sessionId: "s1", status: "live", note: "Live: X" });
    const fallback = chatReducer(live, { type: "result", live: false, note: "Fallback aktif" });
    expect(fallback).toMatchObject({ sessionId: "s1", status: "fallback" });
  });

  it("failed menambah pesan galat dan mematikan loading", () => {
    const state = chatReducer({ ...INITIAL_CHAT_STATE, loading: true }, { type: "failed", message: "Do gagal merespons" });
    expect(state.messages.at(-1)).toEqual(bot("Do gagal merespons"));
    expect(state.loading).toBe(false);
  });

  it("session-loaded: live hanya bila model jawaban terakhir = model aktif", () => {
    const messages = [user("Q"), bot("A", { status: "live", model: "m1" })];
    const same = chatReducer(INITIAL_CHAT_STATE, { type: "session-loaded", messages, modelId: "m1", modelLabel: "M1" });
    expect(same).toMatchObject({ status: "live", note: "Live: M1", view: "chat" });
    const other = chatReducer(INITIAL_CHAT_STATE, { type: "session-loaded", messages, modelId: "m2", modelLabel: "M2" });
    expect(other).toMatchObject({ status: "ready", note: null });
    const empty = chatReducer(INITIAL_CHAT_STATE, { type: "session-loaded", messages: [], modelId: "m1", modelLabel: "M1" });
    expect(empty).toMatchObject({ messages: [], note: EMPTY_SESSION_NOTE, view: "chat" });
  });

  it("session-deleted hanya mereset bila sesi yang aktif", () => {
    const active: ChatState = { ...INITIAL_CHAT_STATE, sessionId: "s1", messages: [user("Q")], view: "chat" };
    expect(chatReducer(active, { type: "session-deleted", id: "s2" })).toBe(active);
    expect(chatReducer(active, { type: "session-deleted", id: "s1" })).toMatchObject({ sessionId: null, messages: [], view: "landing" });
  });

  it("new-chat memulai sesi baru dengan sapaan", () => {
    const state = chatReducer({ ...INITIAL_CHAT_STATE, sessionId: "s1", status: "live" }, { type: "new-chat", greeting: "Halo" });
    expect(state).toMatchObject({ sessionId: null, messages: [{ role: "assistant", content: "Halo" }], status: "ready", view: "chat" });
  });

  it("action-decided memperbarui kartu aksi; tanpa status = tetap pending", () => {
    const pending = { id: "a1", name: "x", summary: "Ubah stok", status: "pending" as const };
    const start: ChatState = { ...INITIAL_CHAT_STATE, messages: [user("Q"), bot("A", { pending_action: pending })] };
    const confirmed = chatReducer(start, { type: "action-decided", index: 1, status: "confirmed", note: "Beres" });
    expect(confirmed.messages[1].meta?.pending_action).toMatchObject({ status: "confirmed", result_note: "Beres" });
    const retry = chatReducer(start, { type: "action-decided", index: 1, note: "Jaringan bermasalah" });
    expect(retry.messages[1].meta?.pending_action).toMatchObject({ status: "pending", result_note: "Jaringan bermasalah" });
    expect(chatReducer(start, { type: "action-decided", index: 0, note: "x" }).messages).toEqual(start.messages);
  });

  it("regenerate membuang jawaban terakhir dan pertanyaan yang diulang", () => {
    const q = user("Q2");
    const state: ChatState = { ...INITIAL_CHAT_STATE, messages: [user("Q1"), bot("A1"), q, bot("A2")] };
    expect(chatReducer(state, { type: "regenerate", lastUser: q }).messages).toEqual([user("Q1"), bot("A1")]);
  });

  it("reset kembali ke keadaan awal", () => {
    expect(chatReducer({ ...INITIAL_CHAT_STATE, sessionId: "s1" }, { type: "reset" })).toBe(INITIAL_CHAT_STATE);
  });
});

describe("helper percakapan", () => {
  it("statusNote memakai label model saat catatan bawaan", () => {
    expect(statusNote(INITIAL_CHAT_STATE, "GPT")).toBe("Do siap · GPT");
    expect(statusNote({ ...INITIAL_CHAT_STATE, note: "Fallback aktif" }, "GPT")).toBe("Fallback aktif");
  });

  it("label pesan menyebut lampiran", () => {
    expect(userMessageLabel("Cek", [])).toBe("Cek");
    expect(userMessageLabel("Cek", [{ name: "a.pdf", text: "", method: "pdf", truncated: false, chars: 0 }])).toBe("Cek\n\n[Lampiran: a.pdf]");
  });

  it("mapSessionMessages hanya mengambil giliran user/asisten", () => {
    expect(mapSessionMessages([{ role: "system", content: "x" }, { role: "user", content: "Q" }, { role: "tool", content: "t" }])).toEqual([
      { role: "user", content: "Q", meta: undefined },
    ]);
    expect(mapSessionMessages(null)).toEqual([]);
  });

  it("lastUserMessage", () => {
    const q = user("Q2");
    expect(lastUserMessage([user("Q1"), q, bot("A")])).toBe(q);
    expect(lastUserMessage([bot("A")])).toBeUndefined();
  });

  it("formatPlainChatText membuang markdown ringan", () => {
    expect(formatPlainChatText("# Judul\n**tebal** dan `kode`\n* poin\n> kutip")).toBe("Judul\ntebal dan kode\n- poin\nkutip");
  });

  it("pendingActionOutcome", () => {
    const base = { id: "a", name: "n", summary: "s" };
    expect(pendingActionOutcome({ ...base, status: "confirmed" })).toBe("Aksi sudah dijalankan.");
    expect(pendingActionOutcome({ ...base, status: "expired" })).toBe("Aksi kedaluwarsa tanpa dikonfirmasi.");
    expect(pendingActionOutcome({ ...base, status: "failed", result_note: "Stok kurang" })).toBe("Stok kurang");
  });
});
