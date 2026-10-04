"use client";

import { useEffect, useRef } from "react";
import type { InterviewPortalCurrentTurn } from "../types";

function cancelSpeech() {
  if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
}

/**
 * Bacakan pertanyaan: audio TTS server bila ada, fallback Web Speech API.
 * Audio yang sedang diputar dihentikan saat komponen dilepas.
 */
export function useQuestionSpeech() {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(
    () => () => {
      audioRef.current?.pause();
      cancelSpeech();
    },
    []
  );

  return (turn: InterviewPortalCurrentTurn) => {
    if (turn.question_audio_base64) {
      audioRef.current?.pause();
      const audio = new Audio(`data:audio/mpeg;base64,${turn.question_audio_base64}`);
      audioRef.current = audio;
      void audio.play().catch(() => undefined);
      return;
    }
    if (typeof speechSynthesis !== "undefined") {
      cancelSpeech();
      const utterance = new SpeechSynthesisUtterance(turn.question);
      utterance.lang = "id-ID";
      speechSynthesis.speak(utterance);
    }
  };
}
