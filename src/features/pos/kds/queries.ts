"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listKdsOrders, listKdsStalls, updateKdsOrderStatus } from "./api";
import { kdsQueryKeys } from "./query-keys";
import type { KdsListParams } from "./types";

export interface UseKdsOptions extends KdsListParams {
  pollInterval?: number;
}

let kdsAudioCtx: AudioContext | null = null;

function getKdsAudioContext() {
  const AudioContextClass =
    window.AudioContext ||
    (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) return null;
  if (!kdsAudioCtx) kdsAudioCtx = new AudioContextClass();
  return kdsAudioCtx;
}

export function unlockKdsSound() {
  const audioCtx = getKdsAudioContext();
  if (audioCtx?.state === "suspended") void audioCtx.resume();
}

export function playNotificationSound() {
  try {
    const audioCtx = getKdsAudioContext();
    if (!audioCtx) return;
    if (audioCtx.state === "suspended") void audioCtx.resume();
    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(880, audioCtx.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(440, audioCtx.currentTime + 0.3);
    gainNode.gain.setValueAtTime(0.3, audioCtx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3);
    oscillator.start(audioCtx.currentTime);
    oscillator.stop(audioCtx.currentTime + 0.3);
  } catch {
    // Audio not supported
  }
}

export function useKds(options: UseKdsOptions = {}) {
  const { pollInterval = 3000, ...listParams } = options;
  const queryClient = useQueryClient();
  const [soundEnabled, setSoundEnabled] = useState(true);
  const prevOrderIds = useRef<Set<string>>(new Set());

  const query = useQuery({
    queryKey: kdsQueryKeys.list(listParams),
    queryFn: () => listKdsOrders(listParams),
    refetchInterval: pollInterval,
  });

  useEffect(() => {
    const fetched = query.data;
    if (!fetched || !soundEnabled) return;
    if (prevOrderIds.current.size > 0) {
      const newOrders = fetched.filter((order) => !prevOrderIds.current.has(order.id));
      if (newOrders.length > 0) playNotificationSound();
    }
    prevOrderIds.current = new Set(fetched.map((order) => order.id));
  }, [query.data, soundEnabled]);

  const updateStatus = useCallback(
    async (
      orderId: string,
      newStatus: string,
      reason?: string,
      station?: string,
      itemIds?: string[]
    ) => {
      const data = await updateKdsOrderStatus(
        orderId,
        newStatus,
        reason,
        station,
        itemIds
      );
      if (data.success) {
        // Refetch immediately — optimistic whole-order status is wrong for per-item bumps.
        await queryClient.invalidateQueries({ queryKey: kdsQueryKeys.all });
      }
      return data;
    },
    [queryClient]
  );

  return {
    orders: query.data ?? [],
    loading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
    soundEnabled,
    setSoundEnabled,
    refresh: query.refetch,
    updateStatus,
  };
}

export function useKdsStalls() {
  const query = useQuery({
    queryKey: kdsQueryKeys.stalls,
    queryFn: listKdsStalls,
    staleTime: 60_000,
  });

  return {
    stalls: query.data ?? [],
    loading: query.isLoading,
  };
}
