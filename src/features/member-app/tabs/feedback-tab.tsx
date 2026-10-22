"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { COMPLAINT_CATEGORIES, type ComplaintCategory, type ComplaintKind, type ComplaintStatus, MEMBER_CATEGORY_LABEL, MEMBER_REPORT_MAX_LENGTH, MEMBER_REPORT_MIN_LENGTH } from "@/lib/studio/complaints";
import { friendlyDay, jam, memberFetch } from "../lib";
import { CenterSpinner, Empty, Eyebrow, Notice, PageTitle, PillButton, SectionTitle, Tag } from "../ui";

/**
 * Send feedback / Report an issue (EPIC-067 T-067-B4). Laporan masuk sebagai
 * tiket keluhan (source Member App); masukan tanpa batas waktu. Member melihat
 * status ringkas dan mengonfirmasi tiket yang ditandai selesai.
 */

interface Report {
  id: string;
  code: string;
  kind: ComplaintKind;
  category: ComplaintCategory;
  status: ComplaintStatus;
  status_label: string;
  message: string | null;
  session_label: string | null;
  created_at: string;
}

interface SessionOption {
  id: string;
  program_name: string;
  session_date: string;
  start_time: string;
  coach_name: string | null;
}

interface FeedbackData {
  reports: Report[];
  sessions: SessionOption[];
}

const KIND_COPY: Record<ComplaintKind, { label: string; hint: string; placeholder: string }> = {
  complaint: {
    label: "Report an issue",
    hint: "Something went wrong — we'll follow up and keep you posted here.",
    placeholder: "Tell us what happened, when, and who was involved.",
  },
  feedback: {
    label: "Send feedback",
    hint: "Ideas, suggestions, or a shout-out for your coach.",
    placeholder: "What should we keep doing, or do better?",
  },
};

const EMPTY = { kind: "complaint" as ComplaintKind, category: "" as ComplaintCategory | "", session_id: "", message: "" };
// nh-dark-input: penawar aturan global input terang di globals.css.
const fieldClass = "nh-dark-input w-full border px-3 py-3 text-sm outline-none transition [color-scheme:dark]";
const sessionLabel = (s: SessionOption) => `${s.program_name} · ${friendlyDay(s.session_date)} ${jam(s.start_time)}${s.coach_name ? ` · ${s.coach_name}` : ""}`;

export function FeedbackTab() {
  const [data, setData] = useState<FeedbackData | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const load = useCallback(
    () =>
      memberFetch<{ data: FeedbackData }>("/api/member-portal/studio/feedback")
        .then((r) => setData(r.data))
        .catch(() => setData({ reports: [], sessions: [] })),
    []
  );

  useEffect(() => {
    load();
  }, [load]);

  if (!data) return <CenterSpinner />;

  const length = form.message.trim().length;
  const valid = form.category !== "" && length >= MEMBER_REPORT_MIN_LENGTH && length <= MEMBER_REPORT_MAX_LENGTH;
  const copy = KIND_COPY[form.kind];

  async function submit() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await memberFetch<{ message: string }>("/api/member-portal/studio/feedback", {
        method: "POST",
        body: { kind: form.kind, category: form.category, message: form.message.trim(), session_id: form.session_id || null },
      });
      setMsg({ tone: "ok", text: r.message });
      setForm(EMPTY);
      await load();
    } catch (e) {
      setMsg({ tone: "error", text: e instanceof Error ? e.message : "Couldn't send your report" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-10">
      <PageTitle sub="Tell us how it's going — every message reaches the NüHabit team.">
        Help &amp;
        <br />
        feedback
      </PageTitle>

      <section className="space-y-5">
        <div className="grid grid-cols-2 border border-white/15" role="tablist" aria-label="Type">
          {(Object.keys(KIND_COPY) as ComplaintKind[]).map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={form.kind === k}
              onClick={() => { setForm((f) => ({ ...f, kind: k })); setMsg(null); }}
              className={`py-3 text-[11px] font-bold uppercase tracking-[0.12em] ${form.kind === k ? "bg-nh-lime text-black" : "text-nh-beige/70 hover:text-white"}`}
            >
              {KIND_COPY[k].label}
            </button>
          ))}
        </div>
        <p className="text-sm text-nh-beige/70">{copy.hint}</p>

        <div>
          <Eyebrow className="mb-2">About</Eyebrow>
          <div className="flex flex-wrap gap-1.5">
            {COMPLAINT_CATEGORIES.map((c) => (
              <button
                key={c}
                type="button"
                aria-pressed={form.category === c}
                onClick={() => setForm((f) => ({ ...f, category: c }))}
                className={`border px-3 py-2 text-xs font-bold uppercase tracking-[0.08em] ${form.category === c ? "border-nh-lime bg-nh-lime text-black" : "border-white/25 text-white hover:border-white/60"}`}
              >
                {MEMBER_CATEGORY_LABEL[c]}
              </button>
            ))}
          </div>
          {form.kind === "complaint" && form.category === "injury" && (
            <p className="mt-3 border-l-2 border-nh-ochre bg-nh-ochre/10 px-3 py-2 text-xs text-nh-lemon">
              Our coaching team is alerted right away. If you need urgent medical help, call emergency services first.
            </p>
          )}
        </div>

        <label className="block">
          <Eyebrow className="mb-2">Session (optional)</Eyebrow>
          <select className={fieldClass} value={form.session_id} onChange={(e) => setForm((f) => ({ ...f, session_id: e.target.value }))} aria-label="Session">
            <option value="">Not about a specific session</option>
            {data.sessions.map((s) => (
              <option key={s.id} value={s.id}>
                {sessionLabel(s)}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <Eyebrow className="mb-2">Message</Eyebrow>
          <textarea
            rows={5}
            className={fieldClass}
            placeholder={copy.placeholder}
            maxLength={MEMBER_REPORT_MAX_LENGTH}
            value={form.message}
            onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))}
          />
          {length > 0 && length < MEMBER_REPORT_MIN_LENGTH && (
            <span className="mt-1 block text-[11px] text-nh-beige/50">At least {MEMBER_REPORT_MIN_LENGTH} characters.</span>
          )}
        </label>

        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
        <PillButton className="w-full" disabled={!valid || busy} onClick={submit}>
          {busy && <Loader2 className="size-4 animate-spin" />}
          {form.kind === "feedback" ? "Send feedback" : "Send report"}
        </PillButton>
      </section>

      <section>
        <SectionTitle>Your reports</SectionTitle>
        {data.reports.length === 0 ? (
          <Empty title="Nothing sent yet." hint="Reports and feedback you send show up here with their status." />
        ) : (
          <div className="border-t border-white/15">
            {data.reports.map((r) => (
              <ReportRow key={r.id} report={r} onChanged={load} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function ReportRow({ report: r, onChanged }: { report: Report; onChanged: () => Promise<unknown> }) {
  const [reopening, setReopening] = useState(false);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  async function respond(resolved: boolean) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await memberFetch<{ message: string }>(`/api/member-portal/studio/feedback/${r.id}/confirm`, {
        method: "POST",
        body: { resolved, comment: comment.trim() || null },
      });
      setMsg({ tone: "ok", text: res.message });
      setReopening(false);
      await onChanged();
    } catch (e) {
      setMsg({ tone: "error", text: e instanceof Error ? e.message : "Couldn't save" });
    } finally {
      setBusy(false);
    }
  }

  const tone = r.status === "resolved" ? "lime" : r.status === "received" || r.status === "in_progress" ? "warn" : "muted";
  return (
    <div className="space-y-2 border-b border-white/15 py-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-bold uppercase tracking-[0.04em] text-white">
            {r.kind === "feedback" ? "Feedback" : "Report"} · {MEMBER_CATEGORY_LABEL[r.category]}
          </p>
          <p className="text-[11px] uppercase tracking-wide text-nh-beige/55">
            {r.code} · {new Date(r.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Asia/Jakarta" })}
            {r.session_label ? ` · ${r.session_label}` : ""}
          </p>
        </div>
        <Tag tone={tone}>{r.status_label}</Tag>
      </div>
      {r.message && <p className="line-clamp-3 text-sm text-nh-beige/75">{r.message}</p>}
      {r.status === "resolved" && (
        <div className="space-y-2 pt-1">
          <p className="text-sm text-white">Our team marked this as resolved. Is everything sorted?</p>
          {reopening && (
            <textarea
              rows={2}
              className={fieldClass}
              placeholder="What's still not right? (optional)"
              maxLength={500}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
          )}
          <div className="grid grid-cols-2 gap-2">
            {!reopening ? (
              <>
                <PillButton disabled={busy} onClick={() => respond(true)}>Yes, all good</PillButton>
                <PillButton variant="ghost" disabled={busy} onClick={() => setReopening(true)}>Not yet</PillButton>
              </>
            ) : (
              <>
                <PillButton variant="light" disabled={busy} onClick={() => respond(false)}>
                  {busy && <Loader2 className="size-4 animate-spin" />} Reopen
                </PillButton>
                <PillButton variant="ghost" disabled={busy} onClick={() => setReopening(false)}>Back</PillButton>
              </>
            )}
          </div>
        </div>
      )}
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
    </div>
  );
}
