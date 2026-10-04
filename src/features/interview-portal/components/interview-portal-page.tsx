"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Camera, Clock, Loader2, PartyPopper } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LiveChatWidget } from "@/components/recruitment/live-chat-widget";
import { LoadingScreen, StatusScreen, StatusShell } from "@/features/psikotes-portal/components/status-screen";
import {
  answerInterviewText,
  answerInterviewVoice,
  fetchInterviewLiveChat,
  sendInterviewLiveChat,
  startInterviewSession,
} from "../api";
import { requestInterviewFullscreen, useInterviewProctoring } from "../hooks/use-interview-proctoring";
import { useInterviewRecording } from "../hooks/use-interview-recording";
import { useQuestionSpeech } from "../hooks/use-question-speech";
import { useVoiceRecorder } from "../hooks/use-voice-recorder";
import { useInterviewSession, useRefreshInterviewSession } from "../queries";
import type { InterviewAnswerResult, InterviewPortalCurrentTurn } from "../types";
import { AnswerControls } from "./answer-controls";
import { InterviewLanding } from "./interview-landing";
import { InterviewRoom } from "./interview-room";

const errorMessage = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

function acquireCameraAndMic() {
  return navigator.mediaDevices.getUserMedia({
    video: { width: 640, height: 480, facingMode: "user" },
    audio: { echoCancellation: true, noiseSuppression: true },
  });
}

/**
 * Portal interview AI kandidat (EPIC-003): wajib on-cam, AI bertanya dgn
 * suara (TTS), kandidat menjawab lewat mikrofon (→ transkrip Whisper) atau
 * ketik. Proctoring: tab/fullscreen/paste + snapshot + deteksi wajah.
 */
export function InterviewPortalPage({ token }: { token: string }) {
  const { data, error, isPending } = useInterviewSession(token);
  const refresh = useRefreshInterviewSession(token);
  const speak = useQuestionSpeech();
  const recorder = useVoiceRecorder();

  const [stream, setStream] = useState<MediaStream | null>(null);
  // turn terbaru dari respons start/answer (membawa audio TTS) mendahului data query
  const [pushedTurn, setPushedTurn] = useState<InterviewPortalCurrentTurn | null>(null);
  const [done, setDone] = useState(false);
  const [starting, setStarting] = useState(false);
  const [sending, setSending] = useState(false);
  const [typeMode, setTypeMode] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const session = data?.session ?? null;
  const currentTurn = pushedTurn ?? data?.current_turn ?? null;
  const inProgress = session?.status === "in_progress" && !done;

  useInterviewProctoring(token, Boolean(inProgress && stream), stream);
  // rekaman video penuh sesi, diputar HRD dari panel Interview
  useInterviewRecording(token, Boolean(inProgress && stream), stream);

  // track kamera dihentikan saat stream diganti atau halaman dilepas
  useEffect(() => () => stream?.getTracks().forEach((t) => t.stop()), [stream]);

  // live chat dgn HRD sejak link dibuka (sent) sampai sesi berjalan
  const chatFetch = useCallback((after?: string) => fetchInterviewLiveChat(token, after), [token]);
  const chatSend = useCallback((message: string) => sendInterviewLiveChat(token, message), [token]);
  const chatWidget = (
    <LiveChatWidget
      fetchMessages={chatFetch}
      sendMessage={chatSend}
      enabled={session?.status === "sent" || inProgress}
    />
  );

  const handleStart = async () => {
    setStarting(true);
    setActionError(null);
    try {
      setStream(await acquireCameraAndMic());
    } catch {
      setActionError(
        "Kamera & mikrofon wajib diizinkan untuk interview ini. Periksa izin browser Anda lalu coba lagi."
      );
      setStarting(false);
      return;
    }
    try {
      const { turn } = await startInterviewSession(token);
      requestInterviewFullscreen();
      await refresh();
      if (turn) {
        setPushedTurn(turn);
        speak(turn);
      }
    } catch (e) {
      setActionError(errorMessage(e, "Gagal memulai interview"));
    } finally {
      setStarting(false);
    }
  };

  // reload di tengah sesi: kamera perlu diaktifkan ulang lewat gesture
  const handleResume = async () => {
    setStarting(true);
    setActionError(null);
    try {
      setStream(await acquireCameraAndMic());
      requestInterviewFullscreen();
      if (currentTurn) speak(currentTurn);
    } catch {
      setActionError("Kamera & mikrofon wajib diizinkan untuk melanjutkan interview.");
    } finally {
      setStarting(false);
    }
  };

  const submitAnswer = async (send: () => Promise<InterviewAnswerResult>) => {
    setSending(true);
    setActionError(null);
    try {
      const result = await send();
      if (result.done) setDone(true);
      await refresh();
      setPushedTurn(result.turn ?? null);
      if (result.turn) speak(result.turn);
    } catch (e) {
      setActionError(errorMessage(e, "Gagal mengirim jawaban"));
    } finally {
      setSending(false);
    }
  };

  const handleStartRecording = () => {
    if (!stream || !currentTurn || recorder.recording) return;
    setActionError(null);
    const turnId = currentTurn.id;
    const problem = recorder.start(stream, (blob) =>
      submitAnswer(() => answerInterviewVoice(token, turnId, blob))
    );
    if (problem === "no-mic") setActionError("Mikrofon tidak tersedia — gunakan mode ketik.");
    if (problem === "unsupported") {
      setActionError("Perekam suara tidak didukung browser ini — gunakan mode ketik.");
      setTypeMode(true);
    }
  };

  const handleSubmitText = (text: string) => {
    if (!currentTurn || !text) return;
    const turnId = currentTurn.id;
    void submitAnswer(() => answerInterviewText(token, turnId, text));
  };

  if (isPending) return <LoadingScreen />;

  if (error || !session) {
    return (
      <StatusScreen icon={AlertTriangle} iconClassName="text-amber-500" title="Link interview tidak berlaku">
        {error?.message ?? "Periksa kembali tautan dari HR, atau hubungi HR untuk link baru."}
      </StatusScreen>
    );
  }

  if (session.status === "expired") {
    return (
      <StatusScreen icon={Clock} iconClassName="text-red-500" title="Link interview sudah kedaluwarsa">
        Hubungi HR untuk mendapatkan undangan interview yang baru.
      </StatusScreen>
    );
  }

  if (session.status === "completed" || done) {
    return (
      <StatusScreen icon={PartyPopper} iconClassName="text-emerald-500" title={`Terima kasih, ${session.candidate_name}!`}>
        Interview Anda sudah selesai. Hasilnya akan ditinjau oleh tim HR dan kami akan
        menghubungi Anda untuk tahap berikutnya.
      </StatusScreen>
    );
  }

  if (session.status === "sent") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 via-white to-pink-50 px-4 py-8">
        <InterviewLanding session={session} starting={starting} error={actionError} onStart={handleStart} />
        {chatWidget}
      </div>
    );
  }

  // in_progress tapi kamera belum aktif (reload di tengah sesi)
  if (!stream) {
    return (
      <StatusShell>
        <Camera className="mx-auto mb-3 size-8 text-muted-foreground" />
        <h1 className="text-base font-semibold">Lanjutkan Interview</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Sesi Anda masih berjalan. Aktifkan kembali kamera & mikrofon untuk melanjutkan.
        </p>
        {actionError && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{actionError}</p>}
        <Button type="button" className="mt-4 w-full" onClick={handleResume} disabled={starting}>
          {starting && <Loader2 className="size-4 animate-spin" />}
          Aktifkan Kamera & Lanjutkan
        </Button>
        {chatWidget}
      </StatusShell>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-pink-50 px-4 py-6">
      <InterviewRoom
        stream={stream}
        maxQuestions={session.max_questions}
        answeredTurns={data?.turns.filter((t) => t.answered_at) ?? []}
        currentTurn={currentTurn}
        recording={recorder.recording}
        error={actionError}
        onReplay={speak}
      >
        {currentTurn && (
          <AnswerControls
            key={currentTurn.id}
            sending={sending}
            recording={recorder.recording}
            recordMs={recorder.recordMs}
            typeMode={typeMode}
            onTypeModeChange={setTypeMode}
            onStartRecording={handleStartRecording}
            onStopRecording={recorder.stop}
            onSubmitText={handleSubmitText}
          />
        )}
      </InterviewRoom>
      {chatWidget}
    </div>
  );
}
