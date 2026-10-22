"use client";

import { useCallback, useEffect, useState } from "react";
import { HeartPulse, Loader2 } from "lucide-react";
import { PARQ_DETAILS_MAX } from "@/lib/studio/parq";
import { useMember } from "../member-app";
import { memberFetch } from "../lib";
import { CenterSpinner, Eyebrow, Notice, PageTitle, PillButton } from "../ui";

/**
 * Health check (PAR-Q) di Member App (EPIC-067 T-067-C3). Diminta lewat banner,
 * tidak memblokir booking. Jawaban "yes" diteruskan ke coach yang mengajar
 * member sebagai catatan medis untuk ditinjau — tidak tampil ke staf lain.
 */

interface ParqStatus {
  due: boolean;
  last: { submitted_at: string; has_yes: boolean; answers: Record<string, boolean>; details: string | null } | null;
  questions: { code: string; text: string }[];
}

const fieldClass = "nh-dark-input w-full border px-3 py-3 text-sm outline-none transition [color-scheme:dark]";
const dateLabel = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Jakarta" });

export function HealthTab() {
  const [status, setStatus] = useState<ParqStatus | null>(null);
  const [answers, setAnswers] = useState<Record<string, boolean>>({});
  const [details, setDetails] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const load = useCallback(
    () =>
      memberFetch<{ data: ParqStatus }>("/api/member-portal/studio/health")
        .then((r) => {
          setStatus(r.data);
          // Isian terakhir jadi titik awal supaya member cukup mengubah yang berbeda.
          setAnswers(r.data.last?.answers ?? {});
          setDetails(r.data.last?.details ?? "");
        })
        .catch(() => setStatus({ due: true, last: null, questions: [] })),
    []
  );

  useEffect(() => {
    load();
  }, [load]);

  if (!status) return <CenterSpinner />;

  const answered = status.questions.every((q) => typeof answers[q.code] === "boolean");
  const anyYes = status.questions.some((q) => answers[q.code]);

  async function submit() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await memberFetch<{ message: string }>("/api/member-portal/studio/health", {
        method: "POST",
        body: { answers, details: anyYes ? details.trim() || null : null, confirm: true },
      });
      setMsg({ tone: "ok", text: r.message });
      setConfirm(false);
      await load();
    } catch (e) {
      setMsg({ tone: "error", text: e instanceof Error ? e.message : "Couldn't save your answers" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-8">
      <PageTitle sub="Before you train hard, tell us about your health. It takes a minute.">
        Health
        <br />
        check
      </PageTitle>

      <div className="border-l-2 border-white/30 bg-white/[0.04] px-4 py-3 text-sm text-nh-beige/80">
        {status.last
          ? status.due
            ? `Your last health check was on ${dateLabel(status.last.submitted_at)}. Please review and confirm your answers.`
            : `Last updated ${dateLabel(status.last.submitted_at)}. Update it any time your health changes.`
          : "Answer yes or no to each question. Only your coaches see what they need to keep you safe."}
      </div>

      <ol className="border-t border-white/15">
        {status.questions.map((q, i) => (
          <li key={q.code} className="border-b border-white/15 py-4">
            <p className="text-sm text-white">
              <span className="mr-2 text-nh-beige/40">{String(i + 1).padStart(2, "0")}</span>
              {q.text}
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2" role="radiogroup" aria-label={q.text}>
              {([true, false] as const).map((v) => (
                <button
                  key={String(v)}
                  type="button"
                  role="radio"
                  aria-checked={answers[q.code] === v}
                  onClick={() => setAnswers((a) => ({ ...a, [q.code]: v }))}
                  className={`border py-2.5 text-[11px] font-bold uppercase tracking-[0.12em] ${
                    answers[q.code] === v ? (v ? "border-nh-ochre bg-nh-ochre/25 text-nh-lemon" : "border-nh-lime bg-nh-lime text-black") : "border-white/25 text-white hover:border-white/60"
                  }`}
                >
                  {v ? "Yes" : "No"}
                </button>
              ))}
            </div>
          </li>
        ))}
      </ol>

      {anyYes && (
        <label className="block">
          <Eyebrow className="mb-2">Tell your coach more (optional)</Eyebrow>
          <textarea
            rows={3}
            className={fieldClass}
            maxLength={PARQ_DETAILS_MAX}
            placeholder="E.g. knee surgery in 2024, cleared by my doctor; asthma, I carry an inhaler."
            value={details}
            onChange={(e) => setDetails(e.target.value)}
          />
          <span className="mt-2 block text-xs text-nh-beige/60">
            If you answered yes, we recommend checking with your doctor before starting intense training.
          </span>
        </label>
      )}

      <label className="flex items-start gap-3 text-sm text-nh-beige/80">
        <input type="checkbox" className="mt-1 size-4 accent-[#daff59]" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
        I confirm these answers are true and I&apos;ll update them if my health changes.
      </label>

      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      <PillButton className="w-full" disabled={!answered || !confirm || busy} onClick={submit}>
        {busy && <Loader2 className="size-4 animate-spin" />}
        Save health check
      </PillButton>
    </div>
  );
}

/** Banner di Home bila PAR-Q belum diisi / sudah lewat 12 bulan. */
export function HealthCheckBanner() {
  const { go } = useMember();
  const [due, setDue] = useState(false);

  useEffect(() => {
    memberFetch<{ data: { due: boolean } }>("/api/member-portal/studio/health")
      .then((r) => setDue(r.data.due))
      .catch(() => setDue(false));
  }, []);

  if (!due) return null;
  return (
    <button type="button" onClick={() => go("health")} className="flex w-full items-center gap-3 border border-nh-lime/50 bg-nh-lime/10 px-4 py-3 text-left">
      <HeartPulse className="size-5 shrink-0 text-nh-lime" />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-bold uppercase tracking-[0.04em] text-white">Complete your health check</span>
        <span className="block text-xs text-nh-beige/70">One minute — helps your coach keep you safe.</span>
      </span>
      <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-nh-lime">Start</span>
    </button>
  );
}
