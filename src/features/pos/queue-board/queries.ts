"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { listKdsOrders } from "@/features/pos/kds/api";
import { readyItemKeys, splitQueueBoardOrders } from "@/lib/pos/queue-board";
import type { KdsListParams } from "@/lib/pos/kds-types";

let queueAudioCtx: AudioContext | null = null;

function getQueueAudioContext() {
  const AudioContextClass =
    window.AudioContext ||
    (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) return null;
  if (!queueAudioCtx) queueAudioCtx = new AudioContextClass();
  return queueAudioCtx;
}

export function unlockQueueBoardSound() {
  const audioCtx = getQueueAudioContext();
  if (audioCtx?.state === "suspended") void audioCtx.resume();
}

function playReadyChime() {
  try {
    const audioCtx = getQueueAudioContext();
    if (!audioCtx) return;
    if (audioCtx.state === "suspended") void audioCtx.resume();
    const now = audioCtx.currentTime;
    [0, 0.18].forEach((offset, index) => {
      const oscillator = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();
      oscillator.connect(gainNode);
      gainNode.connect(audioCtx.destination);
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(index === 0 ? 660 : 880, now + offset);
      gainNode.gain.setValueAtTime(0.28, now + offset);
      gainNode.gain.exponentialRampToValueAtTime(0.01, now + offset + 0.22);
      oscillator.start(now + offset);
      oscillator.stop(now + offset + 0.22);
    });
  } catch {
    // Audio not supported
  }
}

export function useQueueBoard(params: KdsListParams & { pollInterval?: number } = {}) {
  const { pollInterval = 3000, ...listParams } = params;
  const [soundEnabled, setSoundEnabled] = useState(true);
  const prevReadyItemKeys = useRef<Set<string>>(new Set());

  const query = useQuery({
    queryKey: ["pos", "queue-board", listParams],
    queryFn: () => listKdsOrders({ ...listParams, limit: listParams.limit ?? 80 }),
    refetchInterval: pollInterval,
  });

  const boards = useMemo(
    () => splitQueueBoardOrders(query.data ?? []),
    [query.data]
  );

  useEffect(() => {
    const fetched = query.data;
    if (!fetched) return;
    // Bunyi saat ada menu baru yang siap (termasuk partial), bukan hanya order penuh.
    const nextReadyItems = readyItemKeys(fetched);
    if (soundEnabled && prevReadyItemKeys.current.size > 0) {
      const newlyReady = [...nextReadyItems].filter(
        (key) => !prevReadyItemKeys.current.has(key)
      );
      if (newlyReady.length > 0) playReadyChime();
    }
    prevReadyItemKeys.current = nextReadyItems;
  }, [query.data, soundEnabled]);

  return {
    preparing: boards.preparing,
    ready: boards.ready,
    loading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
    soundEnabled,
    setSoundEnabled,
    refresh: query.refetch,
  };
}
