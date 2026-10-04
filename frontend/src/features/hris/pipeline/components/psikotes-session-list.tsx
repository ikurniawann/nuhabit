"use client";

import { scoreBadgeClass } from "@/lib/recruitment/psikotes";
import { isPsikotesTestDone } from "@/lib/recruitment/pipeline-stage-rules";
import type { PsikotesSession, PsikotesSessionTest } from "../types";
import { PSIKOTES_TEST_STATUS } from "./psikotes-status";
import { InviteSessionMeta, copyPortalLink } from "./stage-panel-parts";

const SESSION_STATUS_LABELS: Record<PsikotesSession["status"], string> = {
  draft: "Draft",
  sent: "Terkirim",
  in_progress: "Sedang dikerjakan",
  completed: "Selesai",
  expired: "Kedaluwarsa",
};

function TestResultSummary({ test }: { test: PsikotesSessionTest }) {
  if (test.instrument_kind === "mcq" && test.status === "selesai") {
    return (
      <span className="flex items-baseline gap-2">
        <span className={`rounded-md px-2 py-0.5 text-lg font-bold ${scoreBadgeClass(test.score ?? 0)}`}>
          {test.score ?? 0}%
        </span>
        <span className="text-xs text-muted-foreground">
          {test.score_detail?.correct}/{test.score_detail?.total} benar
        </span>
      </span>
    );
  }
  if (test.instrument_kind === "forced_choice" && test.status === "selesai") {
    const dominant = test.score_detail?.dominant ?? [];
    return (
      <span className="text-sm font-semibold text-foreground">
        {dominant.length > 0
          ? dominant.map((d) => `${d.code} — ${d.label}`).join(" · ")
          : "Tidak ada jawaban"}
      </span>
    );
  }
  if (test.instrument_kind === "drawing" && test.status === "reviewed" && test.review_notes) {
    return <span className="line-clamp-2 text-sm text-muted-foreground">{test.review_notes}</span>;
  }
  if (test.instrument_kind === "drawing" && test.status === "perlu_review") {
    return (
      <span className="text-sm font-medium text-amber-600 dark:text-amber-400">
        Menunggu review manual HR
      </span>
    );
  }
  return null;
}

function TestCard({ test, onOpenDetail }: { test: PsikotesSessionTest; onOpenDetail: () => void }) {
  const statusMeta = PSIKOTES_TEST_STATUS[test.status];
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-foreground">{test.instrument_name}</span>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${statusMeta.badge}`}>
          {statusMeta.label}
        </span>
      </div>
      <div className="mt-1.5 empty:hidden">
        <TestResultSummary test={test} />
      </div>
      {isPsikotesTestDone(test) && (
        <button
          type="button"
          onClick={onOpenDetail}
          className="mt-1.5 text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
        >
          Lihat detail →
        </button>
      )}
    </div>
  );
}

/** Daftar undangan psikotes + kartu hasil per instrumen. */
export function PsikotesSessionList({
  sessions,
  onOpenTest,
  onOpenProctor,
}: {
  sessions: PsikotesSession[];
  onOpenTest: (test: PsikotesSessionTest) => void;
  onOpenProctor: (session: PsikotesSession) => void;
}) {
  if (sessions.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border py-8 text-center text-sm text-muted-foreground">
        Belum ada undangan tes. Kirim undangan untuk memulai psikotes online.
      </p>
    );
  }
  return (
    <div className="space-y-4">
      {sessions.map((session) => {
        const { token } = session;
        const linkOpen = token && (session.status === "sent" || session.status === "in_progress");
        return (
          <div key={session.id} className="space-y-2">
            <InviteSessionMeta
              statusLabel={SESSION_STATUS_LABELS[session.status]}
              invitedAt={session.invited_at}
              createdByName={session.created_by_name}
              proctor={session.proctor}
              onOpenProctor={() => onOpenProctor(session)}
              onCopyLink={linkOpen ? () => copyPortalLink(`/psikotes/${token}`, "Link tes disalin") : undefined}
            />
            <div className="grid grid-cols-1 gap-2">
              {session.tests.map((test) => (
                <TestCard key={test.id} test={test} onOpenDetail={() => onOpenTest(test)} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
