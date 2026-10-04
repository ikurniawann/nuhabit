"use client";

import { useState } from "react";
import { AlertTriangle, Clock, Loader2, NotebookPen, Star, Timer } from "lucide-react";
import {
  CATEGORY_LABELS,
  CS_CATEGORIES,
  CS_PRIORITIES,
  PRIORITY_LABELS,
  formatDuration,
  type CsCategory,
  type CsPriority,
} from "@/lib/crm/cs-rules";
import { formatDateTime } from "@/lib/format";
import type { InboxConversation, InternalNote } from "../types";

/**
 * EPIC-012 Fase D — panel komplain: kategori/prioritas, metrik SLA, dan
 * catatan internal antar-agent (tidak pernah terkirim ke customer).
 */

const PRIORITY_STYLES: Record<CsPriority, string> = {
  low: "bg-slate-100 text-slate-600",
  normal: "bg-sky-50 text-sky-700",
  high: "bg-amber-50 text-amber-700",
  urgent: "bg-red-50 text-red-700",
};

export function ComplaintPanel({
  conversation,
  notes,
  onSetComplaint,
  onAddNote,
}: {
  conversation: InboxConversation;
  notes: InternalNote[];
  onSetComplaint: (payload: {
    is_complaint: boolean;
    category?: CsCategory | null;
    priority?: CsPriority;
  }) => Promise<unknown>;
  onAddNote: (body: string) => Promise<unknown>;
}) {
  const [noteDraft, setNoteDraft] = useState("");
  const [savingNote, setSavingNote] = useState(false);

  const isComplaint = conversation.is_complaint ?? false;
  const priority = (conversation.priority ?? "normal") as CsPriority;

  async function submitNote() {
    const body = noteDraft.trim();
    if (!body || savingNote) return;
    setSavingNote(true);
    try {
      await onAddNote(body);
      setNoteDraft("");
    } finally {
      setSavingNote(false);
    }
  }

  return (
    <div className="space-y-4 border-t border-slate-200 p-4">
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <AlertTriangle className="size-3.5" /> Komplain
          </h3>
          <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-slate-600">
            <input
              type="checkbox"
              checked={isComplaint}
              onChange={(event) =>
                void onSetComplaint({ is_complaint: event.target.checked })
              }
              className="size-3.5 rounded border-slate-300"
            />
            Tandai komplain
          </label>
        </div>

        {isComplaint && (
          <div className="space-y-2">
            <label className="block space-y-1">
              <span className="text-[11px] text-slate-500">Kategori</span>
              <select
                value={conversation.category ?? ""}
                onChange={(event) =>
                  void onSetComplaint({
                    is_complaint: true,
                    category: (event.target.value || null) as CsCategory | null,
                  })
                }
                className="h-8 w-full rounded-md border border-slate-300 bg-white px-2 text-xs outline-none focus:border-violet-400"
              >
                <option value="">Belum dikategorikan</option>
                {CS_CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {CATEGORY_LABELS[category]}
                  </option>
                ))}
              </select>
            </label>

            <div className="space-y-1">
              <span className="text-[11px] text-slate-500">Prioritas</span>
              <div className="flex gap-1">
                {CS_PRIORITIES.map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => void onSetComplaint({ is_complaint: true, priority: option })}
                    className={`flex-1 rounded-md px-1.5 py-1 text-[11px] font-medium transition ${
                      priority === option
                        ? PRIORITY_STYLES[option] + " ring-1 ring-inset ring-current"
                        : "bg-slate-50 text-slate-400 hover:bg-slate-100"
                    }`}
                  >
                    {PRIORITY_LABELS[option]}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </section>

      <section className="space-y-1.5 rounded-md border border-slate-200 bg-slate-50/60 p-2.5">
        <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          <Timer className="size-3" /> SLA
        </h3>
        {conversation.sla_response_breached && (
          <div className="flex items-center gap-1.5 rounded bg-red-50 px-2 py-1 text-[11px] font-medium text-red-700">
            <AlertTriangle className="size-3" />
            Lewat batas balas
            {conversation.escalated_at && ` · sejak ${formatDateTime(conversation.escalated_at)}`}
          </div>
        )}
        <MetricRow
          icon={Clock}
          label="Menunggu sejak"
          value={conversation.awaiting_since ? formatDateTime(conversation.awaiting_since) : "tidak ada"}
        />
        <MetricRow
          icon={Timer}
          label="Respons pertama"
          value={formatDuration(conversation.first_response_seconds ?? null)}
        />
        <MetricRow
          icon={Timer}
          label="Waktu selesai"
          value={formatDuration(conversation.resolution_seconds ?? null)}
        />
        {conversation.csat_score != null && (
          <MetricRow
            icon={Star}
            label="Rating customer"
            value={`${conversation.csat_score}/5`}
          />
        )}
      </section>

      <section>
        <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
          <NotebookPen className="size-3.5" /> Catatan Internal
        </h3>
        <p className="mb-1.5 text-[10px] text-slate-400">
          Hanya terlihat agent — tidak dikirim ke customer.
        </p>
        <div className="flex gap-1.5">
          <textarea
            value={noteDraft}
            onChange={(event) => setNoteDraft(event.target.value)}
            rows={2}
            placeholder="Tulis catatan..."
            className="flex-1 resize-y rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs outline-none focus:border-violet-400"
          />
          <button
            type="button"
            onClick={() => void submitNote()}
            disabled={savingNote || !noteDraft.trim()}
            className="h-8 shrink-0 self-end rounded-md bg-slate-800 px-2.5 text-xs font-medium text-white transition hover:bg-slate-700 disabled:opacity-50"
          >
            {savingNote ? <Loader2 className="size-3.5 animate-spin" /> : "Simpan"}
          </button>
        </div>

        {notes.length > 0 && (
          <div className="mt-2 space-y-1.5">
            {notes.map((note) => (
              <div key={note.id} className="rounded-md border border-amber-200 bg-amber-50/70 px-2 py-1.5 text-xs">
                <p className="whitespace-pre-wrap break-words text-slate-700">{note.body}</p>
                <div className="mt-0.5 text-[10px] text-slate-400">
                  {note.author_name || "Agent"} · {formatDateTime(note.created_at)}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function MetricRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Clock;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between text-[11px]">
      <span className="inline-flex items-center gap-1 text-slate-500">
        <Icon className="size-3" /> {label}
      </span>
      <span className="font-medium text-slate-700">{value}</span>
    </div>
  );
}
