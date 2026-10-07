"use client";

import { useEffect, useRef } from "react";
import { Loader2, Paperclip, Send, X } from "lucide-react";
import type { AssistantAttachment } from "../../lib/assistant-chat";

const ACCEPTED_FILES = ".pdf,.docx,.doc,.jpg,.jpeg,.png,.webp,.bmp,.tiff,.xlsx,.xls,.xlsm,.csv,.txt,.md,.tsv";

function attachmentKind(item: AssistantAttachment) {
  const kind = item.method === "ocr" ? "OCR" : item.method === "spreadsheet" ? "tabel" : item.method;
  return item.truncated ? `${kind} · dipotong` : kind;
}

/** Kolom tulis Do: catatan status, lampiran, dan textarea yang tumbuh. */
export function AssistantComposer({
  statusNote,
  showBackToSessions,
  onBackToSessions,
  attachments,
  uploading,
  uploadError,
  onAttach,
  onRemoveAttachment,
  input,
  onInputChange,
  onSend,
  sending,
  placeholder,
}: {
  statusNote: string;
  showBackToSessions: boolean;
  onBackToSessions: () => void;
  attachments: AssistantAttachment[];
  uploading: boolean;
  uploadError: string | null;
  onAttach: (files: FileList | null) => void;
  onRemoveAttachment: (index: number) => void;
  input: string;
  onInputChange: (value: string) => void;
  onSend: () => void;
  sending: boolean;
  placeholder: string;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Tinggi textarea mengikuti jumlah baris; direset dulu agar bisa mengecil lagi.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [input]);

  // Reset input berkas setelah unggah supaya berkas yang sama bisa dipilih lagi.
  useEffect(() => {
    if (!uploading && fileInputRef.current) fileInputRef.current.value = "";
  }, [uploading]);

  return (
    <div className="border-t border-white/10 p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="truncate rounded-xl border border-white/10 bg-white/8 px-2.5 py-1.5 text-[11px] text-white/55">{statusNote}</div>
        {showBackToSessions && (
          <button onClick={onBackToSessions} className="ml-2 shrink-0 rounded-xl bg-white/8 px-2.5 py-1.5 text-[11px] text-white/60 hover:bg-white/12">
            Back to Sessions
          </button>
        )}
      </div>
      {(attachments.length > 0 || uploadError) && (
        <div className="mb-2 space-y-1">
          {attachments.map((item, index) => (
            <div
              key={`${item.name}-${index}`}
              className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/8 px-2.5 py-1.5 text-[11px] text-white/70"
            >
              <Paperclip className="size-3 shrink-0 text-white/40" />
              <span className="min-w-0 flex-1 truncate">{item.name}</span>
              <span className="shrink-0 text-white/35">{attachmentKind(item)}</span>
              <button
                type="button"
                onClick={() => onRemoveAttachment(index)}
                className="shrink-0 rounded-md p-0.5 text-white/35 transition hover:bg-white/10 hover:text-white/80"
                aria-label={`Hapus lampiran ${item.name}`}
              >
                <X className="size-3" />
              </button>
            </div>
          ))}
          {uploadError && <p className="px-1 text-[11px] text-rose-300">{uploadError}</p>}
        </div>
      )}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSend();
        }}
        className="flex gap-2"
      >
        <input ref={fileInputRef} type="file" multiple accept={ACCEPTED_FILES} className="hidden" onChange={(event) => onAttach(event.target.files)} />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          title="Lampirkan file (PDF, gambar, Excel, CSV)"
          className="grid size-10 shrink-0 place-items-center self-end rounded-xl border border-white/20 bg-white/8 text-white/60 transition hover:bg-white/14 hover:text-white disabled:opacity-50"
        >
          {uploading ? <Loader2 className="size-4 animate-spin" /> : <Paperclip className="size-4" />}
        </button>
        <textarea
          ref={inputRef}
          value={input}
          rows={1}
          onChange={(event) => onInputChange(event.target.value)}
          onKeyDown={(event) => {
            // Enter mengirim; Shift+Enter baris baru. IME memakai Enter untuk
            // memilih kandidat, jadi jangan kirim saat composing.
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              onSend();
            }
          }}
          placeholder={placeholder}
          className="min-h-[40px] max-h-40 min-w-0 flex-1 resize-none rounded-xl border border-white/20 bg-white px-3 py-2 text-sm leading-6 text-black outline-none placeholder:text-gray-600 focus:border-pink-300/70"
        />
        <button disabled={sending || !input.trim()} className="grid size-10 shrink-0 place-items-center self-end rounded-xl bg-pink-600 transition hover:bg-pink-500 disabled:opacity-50">
          <Send className="size-4" />
        </button>
      </form>
    </div>
  );
}
