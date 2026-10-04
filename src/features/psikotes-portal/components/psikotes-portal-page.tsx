"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Clock, PartyPopper } from "lucide-react";
import { LiveChatWidget } from "@/components/recruitment/live-chat-widget";
import { fetchLiveChat, sendLiveChat } from "../api";
import { requestFullscreen, useProctoring } from "../hooks/use-proctoring";
import {
  useFinishPsikotesSession,
  useRefreshPsikotesSession,
  usePsikotesSession,
  useStartPsikotesSession,
  useStartPsikotesTest,
} from "../queries";
import { isTerminalTest, type PortalTest, type PortalTestStartData } from "../types";
import { DrawingRunner } from "./drawing-runner";
import { McqRunner } from "./mcq-runner";
import { PapiRunner } from "./papi-runner";
import { PsikotesLanding } from "./psikotes-landing";
import { LoadingScreen, StatusScreen } from "./status-screen";
import { TestList } from "./test-list";

const RUNNERS = { mcq: McqRunner, forced_choice: PapiRunner, drawing: DrawingRunner } as const;

/** Portal tes kandidat: landing + consent → kerjakan battery → selesai. */
export function PsikotesPortalPage({ token }: { token: string }) {
  const { data, error, isPending } = usePsikotesSession(token);
  const refresh = useRefreshPsikotesSession(token);
  const startSession = useStartPsikotesSession(token);
  const startTest = useStartPsikotesTest(token);
  const finishSession = useFinishPsikotesSession(token);
  const [activeTest, setActiveTest] = useState<PortalTestStartData | null>(null);

  const session = data?.session ?? null;
  const tests = data?.tests ?? [];
  const inProgress = session?.status === "in_progress";
  const allDone = tests.length > 0 && tests.every(isTerminalTest);

  useProctoring(token, inProgress, Boolean(session?.webcam_consent));

  // live chat dgn HRD sejak link dibuka (sent) sampai sesi berjalan
  const chatFetch = useCallback((after?: string) => fetchLiveChat(token, after), [token]);
  const chatSend = useCallback((message: string) => sendLiveChat(token, message), [token]);
  const chatWidget = (
    <LiveChatWidget
      fetchMessages={chatFetch}
      sendMessage={chatSend}
      enabled={session?.status === "sent" || inProgress}
    />
  );

  // seluruh tes selesai → tutup sesi otomatis sekali; bila gagal, TestList
  // menampilkan tombol coba lagi supaya tidak jadi jalan buntu
  const { isIdle: finishIdle, mutate: finish } = finishSession;
  useEffect(() => {
    if (inProgress && allDone && !activeTest && finishIdle) finish();
  }, [inProgress, allDone, activeTest, finishIdle, finish]);

  const handleStartTest = (test: PortalTest) => {
    requestFullscreen();
    startTest.mutate(test.id, { onSuccess: setActiveTest });
  };

  const handleTestFinished = () => {
    setActiveTest(null);
    void refresh();
  };

  if (isPending) return <LoadingScreen />;

  if (error || !session) {
    return (
      <StatusScreen icon={AlertTriangle} iconClassName="text-amber-500" title="Link tes tidak berlaku">
        {error?.message ?? "Periksa kembali tautan dari HR, atau hubungi HR untuk link baru."}
      </StatusScreen>
    );
  }

  if (session.status === "expired") {
    return (
      <StatusScreen icon={Clock} iconClassName="text-red-500" title="Link tes sudah kedaluwarsa">
        Hubungi HR untuk mendapatkan undangan tes yang baru.
      </StatusScreen>
    );
  }

  if (session.status === "completed") {
    return (
      <StatusScreen icon={PartyPopper} iconClassName="text-emerald-500" title={`Terima kasih, ${session.candidate_name}!`}>
        Seluruh rangkaian tes sudah selesai. Hasil akan ditinjau oleh tim HR dan kami akan
        menghubungi Anda untuk tahap berikutnya.
      </StatusScreen>
    );
  }

  if (session.status === "draft" || session.status === "sent") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 via-white to-pink-50 px-4 py-8">
        <PsikotesLanding
          session={session}
          tests={tests}
          starting={startSession.isPending}
          error={startSession.error?.message ?? null}
          onStart={(consent) => startSession.mutate(consent)}
        />
        {chatWidget}
      </div>
    );
  }

  if (activeTest) {
    const Runner = RUNNERS[activeTest.test.instrument.kind];
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-pink-50 px-4 py-6">
        <div className="mx-auto w-full max-w-2xl">
          <Runner token={token} data={activeTest} onFinished={handleTestFinished} />
        </div>
        {chatWidget}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-pink-50 px-4 py-8">
      <TestList
        tests={tests}
        error={startTest.error?.message ?? null}
        finishFailed={finishSession.isError}
        onStartTest={handleStartTest}
        onRetryFinish={() => finishSession.mutate()}
      />
      {chatWidget}
    </div>
  );
}
