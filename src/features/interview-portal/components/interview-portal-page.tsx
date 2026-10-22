"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Clock,
  Keyboard,
  Loader2,
  Mic,
  PartyPopper,
  Send,
  Square,
  Volume2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  answerInterviewText,
  answerInterviewVoice,
  fetchInterviewSession,
  startInterviewSession,
  fetchInterviewLiveChat,
  sendInterviewLiveChat,
} from "../api";
import { LiveChatWidget } from "@/components/recruitment/live-chat-widget";
import {
  useInterviewProctoring,
  requestInterviewFullscreen,
} from "../hooks/use-interview-proctoring";
import { useInterviewRecording } from "../hooks/use-interview-recording";
import type { InterviewPortalCurrentTurn, InterviewPortalData } from "../types";

const MAX_RECORD_MS = 3 * 60 * 1000;

function StatusShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 via-white to-pink-50 px-4">
      <Card className="w-full max-w-md p-6 text-center">{children}</Card>
    </div>
  );
}

function pickRecorderMime(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  for (const mime of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"]) {
    if (MediaRecorder.isTypeSupported(mime)) return mime;
  }
  return undefined;
}

/** Putar audio TTS pertanyaan; fallback Web Speech API bila tidak ada. */
function speakQuestion(turn: InterviewPortalCurrentTurn, audioRef: { current: HTMLAudioElement | null }) {
  if (turn.question_audio_base64) {
    audioRef.current?.pause();
    const audio = new Audio(`data:audio/mpeg;base64,${turn.question_audio_base64}`);
    audioRef.current = audio;
    void audio.play().catch(() => undefined);
    return;
  }
  if (typeof speechSynthesis !== "undefined") {
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(turn.question);
    utterance.lang = "id-ID";
    speechSynthesis.speak(utterance);
  }
}

/**
 * Portal interview AI kandidat (EPIC-003): wajib on-cam, AI bertanya dgn
 * suara (TTS), kandidat menjawab lewat mikrofon (→ transkrip Whisper) atau
 * ketik. Proctoring: tab/fullscreen/paste + snapshot + deteksi wajah.
 */
export function InterviewPortalPage({ token }: { token: string }) {
  const [data, setData] = useState<InterviewPortalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [starting, setStarting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const [stream, setStream] = useState<MediaStream | null>(null);
  const [currentTurn, setCurrentTurn] = useState<InterviewPortalCurrentTurn | null>(null);
  const [done, setDone] = useState(false);

  const [recording, setRecording] = useState(false);
  const [recordMs, setRecordMs] = useState(0);
  const [sending, setSending] = useState(false);
  const [typeMode, setTypeMode] = useState(false);
  const [typedAnswer, setTypedAnswer] = useState("");

  const selfViewRef = useRef<HTMLVideoElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);

  const session = data?.session ?? null;
  const answeredTurns = data?.turns.filter((t) => t.answered_at) ?? [];
  const inProgress = session?.status === "in_progress" && !done;

  useInterviewProctoring(token, Boolean(inProgress && stream), stream);
  // rekaman video penuh sesi — diputar HRD dari panel Interview
  useInterviewRecording(token, Boolean(inProgress && stream), stream);

  // live chat dgn HRD sejak link dibuka (sent) sampai sesi berjalan
  const chatFetch = useCallback((after?: string) => fetchInterviewLiveChat(token, after), [token]);
  const chatSend = useCallback(
    (message: string) => sendInterviewLiveChat(token, message),
    [token]
  );
  const chatEnabled =
    session?.status === "sent" || (session?.status === "in_progress" && !done);
  const chatWidget = (
    <LiveChatWidget fetchMessages={chatFetch} sendMessage={chatSend} enabled={Boolean(chatEnabled)} />
  );

  const reload = useCallback(async () => {
    try {
      const next = await fetchInterviewSession(token);
      setData(next);
      setCurrentTurn(next.current_turn);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Gagal memuat sesi");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Self-view mengikuti stream; bersihkan track saat unmount.
  useEffect(() => {
    if (selfViewRef.current && stream) selfViewRef.current.srcObject = stream;
  }, [stream]);
  useEffect(
    () => () => {
      stream?.getTracks().forEach((t) => t.stop());
      ttsAudioRef.current?.pause();
      if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
    },
    [stream]
  );

  const acquireStream = async (): Promise<MediaStream> => {
    const media = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, facingMode: "user" },
      audio: { echoCancellation: true, noiseSuppression: true },
    });
    setStream(media);
    return media;
  };

  const handleStart = async () => {
    setStarting(true);
    setActionError(null);
    try {
      await acquireStream();
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
      await reload();
      if (turn) {
        setCurrentTurn(turn);
        speakQuestion(turn, ttsAudioRef);
      }
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Gagal memulai interview");
    } finally {
      setStarting(false);
    }
  };

  // Reload di tengah sesi: kamera perlu diaktifkan ulang lewat gesture.
  const handleResume = async () => {
    setStarting(true);
    setActionError(null);
    try {
      await acquireStream();
      requestInterviewFullscreen();
      if (currentTurn) speakQuestion(currentTurn, ttsAudioRef);
    } catch {
      setActionError("Kamera & mikrofon wajib diizinkan untuk melanjutkan interview.");
    } finally {
      setStarting(false);
    }
  };

  const stopRecordTimer = () => {
    if (recordTimerRef.current) {
      clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
  };

  const handleStartRecording = () => {
    if (!stream || recording) return;
    setActionError(null);
    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length === 0) {
      setActionError("Mikrofon tidak tersedia — gunakan mode ketik.");
      return;
    }
    try {
      const mime = pickRecorderMime();
      const recorder = new MediaRecorder(
        new MediaStream(audioTracks),
        mime ? { mimeType: mime, audioBitsPerSecond: 64_000 } : undefined
      );
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        stopRecordTimer();
        setRecording(false);
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        chunksRef.current = [];
        if (blob.size > 0) void submitVoice(blob);
      };
      recorder.start();
      recorderRef.current = recorder;
      setRecording(true);
      setRecordMs(0);
      const startedAt = Date.now();
      recordTimerRef.current = setInterval(() => {
        const elapsed = Date.now() - startedAt;
        setRecordMs(elapsed);
        if (elapsed >= MAX_RECORD_MS) recorderRef.current?.stop();
      }, 500);
    } catch {
      setActionError("Perekam suara tidak didukung browser ini — gunakan mode ketik.");
      setTypeMode(true);
    }
  };

  const handleStopRecording = () => {
    recorderRef.current?.stop();
  };

  const applyAnswerResult = async (result: { done: boolean; turn?: InterviewPortalCurrentTurn | null }) => {
    setTypedAnswer("");
    if (result.done) {
      setDone(true);
      setCurrentTurn(null);
      await reload();
      return;
    }
    await reload();
    if (result.turn) {
      setCurrentTurn(result.turn);
      speakQuestion(result.turn, ttsAudioRef);
    }
  };

  const submitVoice = async (blob: Blob) => {
    if (!currentTurn) return;
    setSending(true);
    setActionError(null);
    try {
      const result = await answerInterviewVoice(token, currentTurn.id, blob);
      await applyAnswerResult(result);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Gagal mengirim jawaban");
    } finally {
      setSending(false);
    }
  };

  const submitText = async () => {
    if (!currentTurn || !typedAnswer.trim()) return;
    setSending(true);
    setActionError(null);
    try {
      const result = await answerInterviewText(token, currentTurn.id, typedAnswer.trim());
      await applyAnswerResult(result);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Gagal mengirim jawaban");
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return (
      <StatusShell>
        <Loader2 className="mx-auto size-6 animate-spin text-muted-foreground" />
      </StatusShell>
    );
  }

  if (loadError || !session) {
    return (
      <StatusShell>
        <AlertTriangle className="mx-auto mb-3 size-8 text-amber-500" />
        <h1 className="text-base font-semibold">Link interview tidak berlaku</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {loadError ?? "Periksa kembali tautan dari HR, atau hubungi HR untuk link baru."}
        </p>
      </StatusShell>
    );
  }

  if (session.status === "expired") {
    return (
      <StatusShell>
        <Clock className="mx-auto mb-3 size-8 text-red-500" />
        <h1 className="text-base font-semibold">Link interview sudah kedaluwarsa</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Hubungi HR untuk mendapatkan undangan interview yang baru.
        </p>
      </StatusShell>
    );
  }

  if (session.status === "completed" || done) {
    return (
      <StatusShell>
        <PartyPopper className="mx-auto mb-3 size-8 text-emerald-500" />
        <h1 className="text-base font-semibold">Terima kasih, {session.candidate_name}!</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Interview Anda sudah selesai. Hasilnya akan ditinjau oleh tim HR dan kami akan
          menghubungi Anda untuk tahap berikutnya.
        </p>
      </StatusShell>
    );
  }

  // ── Landing (status sent) ────────────────────────────────────────────
  if (session.status === "sent") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 via-white to-pink-50 px-4 py-8">
        <Card className="w-full max-w-lg space-y-4 p-6">
          <div>
            <h1 className="text-lg font-semibold">Interview Online dengan AI</h1>
            <p className="text-sm text-muted-foreground">
              Halo <span className="font-medium text-foreground">{session.candidate_name}</span>
              {session.position_title ? ` — posisi ${session.position_title}` : ""}. AI interviewer
              kami akan menanyakan maksimal {session.max_questions} pertanyaan singkat seputar
              pengalaman, keahlian, dan ekspektasi Anda.
            </p>
          </div>

          <div className="space-y-2 rounded-lg bg-amber-50 px-4 py-3 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
            <p className="font-medium">Sebelum mulai:</p>
            <ul className="list-inside list-disc space-y-1">
              <li>
                Interview ini <b>wajib on-cam</b>: kamera & mikrofon harus aktif sepanjang sesi.
              </li>
              <li>Pertanyaan dibacakan dengan suara; jawab dengan berbicara ke mikrofon.</li>
              <li>Pastikan wajah Anda selalu terlihat di kamera dan berada di tempat tenang.</li>
              <li>Berpindah tab, keluar layar penuh, dan keluar dari frame kamera akan tercatat.</li>
            </ul>
          </div>

          <label className="flex items-start gap-2.5 rounded-lg border border-border px-4 py-3 text-sm">
            <Checkbox checked={consent} onCheckedChange={(v) => setConsent(v === true)} />
            <span>
              <Camera className="mr-1 inline size-4 text-muted-foreground" />
              Saya mengizinkan kamera & mikrofon aktif selama interview, termasuk foto berkala dan
              rekaman jawaban suara saya untuk keperluan penilaian rekrutmen.
            </span>
          </label>

          {actionError && <p className="text-sm text-red-600 dark:text-red-400">{actionError}</p>}

          <Button
            type="button"
            className="w-full"
            onClick={handleStart}
            disabled={starting || !consent}
          >
            {starting && <Loader2 className="size-4 animate-spin" />}
            Mulai Interview
          </Button>
        </Card>
        {chatWidget}
      </div>
    );
  }

  // ── in_progress tapi kamera belum aktif (reload di tengah sesi) ──────
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

  // ── Interview berjalan ───────────────────────────────────────────────
  const questionNumber = currentTurn?.turn_no ?? answeredTurns.length;
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-pink-50 px-4 py-6">
      <div className="mx-auto w-full max-w-2xl space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-base font-semibold">Interview Online dengan AI</h1>
            <p className="text-xs text-muted-foreground">
              Pertanyaan {questionNumber} · maks {session.max_questions}
            </p>
          </div>
          {/* Self-view + indikator rekam */}
          <div className="relative">
            <video
              ref={selfViewRef}
              autoPlay
              muted
              playsInline
              className="h-24 w-32 rounded-lg border border-border bg-black object-cover"
            />
            <span className="absolute left-1.5 top-1.5 flex items-center gap-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">
              <span
                className={`size-1.5 rounded-full ${recording ? "animate-pulse bg-red-500" : "bg-emerald-400"}`}
              />
              {recording ? "REC" : "ON CAM"}
            </span>
          </div>
        </div>

        {/* Riwayat tanya-jawab */}
        {answeredTurns.length > 0 && (
          <Card className="max-h-56 space-y-3 overflow-y-auto p-4">
            {answeredTurns.map((t) => (
              <div key={t.id} className="space-y-1 text-sm">
                <p className="font-medium text-foreground">
                  <span className="mr-1 text-xs text-muted-foreground">#{t.turn_no}</span>
                  {t.question}
                </p>
                <p className="flex items-start gap-1.5 text-muted-foreground">
                  <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-500" />
                  <span className="line-clamp-3">{t.answer_transcript || "(tidak menjawab)"}</span>
                </p>
              </div>
            ))}
          </Card>
        )}

        {/* Pertanyaan aktif */}
        {currentTurn ? (
          <Card className="space-y-4 p-5">
            <div className="flex items-start justify-between gap-3">
              <p className="text-base font-medium text-foreground">{currentTurn.question}</p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                title="Putar ulang suara pertanyaan"
                onClick={() => speakQuestion(currentTurn, ttsAudioRef)}
              >
                <Volume2 className="size-4" />
              </Button>
            </div>

            {sending ? (
              <div className="flex items-center gap-2 rounded-lg bg-muted px-4 py-3 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Memproses jawaban Anda (transkrip & pertanyaan berikutnya)…
              </div>
            ) : typeMode ? (
              <div className="space-y-2">
                <Textarea
                  value={typedAnswer}
                  onChange={(e) => setTypedAnswer(e.target.value)}
                  rows={4}
                  maxLength={4000}
                  placeholder="Ketik jawaban Anda di sini…"
                />
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" onClick={submitText} disabled={!typedAnswer.trim()}>
                    <Send className="size-4" /> Kirim Jawaban
                  </Button>
                  <Button type="button" variant="outline" onClick={() => setTypeMode(false)}>
                    <Mic className="size-4" /> Kembali ke suara
                  </Button>
                </div>
              </div>
            ) : recording ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">
                  <span className="size-2 animate-pulse rounded-full bg-red-500" />
                  Merekam… {Math.floor(recordMs / 60000)}:
                  {String(Math.floor((recordMs % 60000) / 1000)).padStart(2, "0")} (maks 3:00)
                </div>
                <Button type="button" className="w-full" onClick={handleStopRecording}>
                  <Square className="size-4" /> Selesai & Kirim Jawaban
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                <Button type="button" className="w-full" onClick={handleStartRecording}>
                  <Mic className="size-4" /> Mulai Bicara
                </Button>
                <button
                  type="button"
                  onClick={() => setTypeMode(true)}
                  className="mx-auto flex items-center gap-1 text-xs text-muted-foreground hover:underline"
                >
                  <Keyboard className="size-3.5" /> Mikrofon bermasalah? Ketik jawaban
                </button>
              </div>
            )}

            {actionError && <p className="text-sm text-red-600 dark:text-red-400">{actionError}</p>}
          </Card>
        ) : (
          <Card className="flex items-center justify-center gap-2 p-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Menyiapkan pertanyaan…
          </Card>
        )}

        <p className="text-center text-[11px] text-muted-foreground">
          Jawaban suara Anda direkam & ditranskrip otomatis. Tetap di halaman ini sampai interview
          selesai.
        </p>
      </div>
      {chatWidget}
    </div>
  );
}
