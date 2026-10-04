"use client";

import { useCallback, useEffect, useReducer } from "react";
import type { DesktopOverview } from "@/lib/desktop/overview";
import { EMPTY_ACTIVITY_FEED, activityFeedReducer } from "../lib/activity-feed";

/**
 * Riwayat + popup notifikasi aktivitas. Snapshot datang dari poll overview
 * (lewat `ingest`) dan LANGSUNG dari Server-Sent Events; poll tetap jalan
 * sebagai jaring pengaman bila SSE diputus proxy.
 */
export function useActivityFeed(streamEnabled: boolean) {
  const [state, dispatch] = useReducer(activityFeedReducer, EMPTY_ACTIVITY_FEED);

  const ingest = useCallback((overview: DesktopOverview) => dispatch({ type: "snapshot", overview }), []);
  const dismiss = useCallback((id: string) => dispatch({ type: "dismiss", id }), []);
  const clear = useCallback(() => dispatch({ type: "clear" }), []);

  useEffect(() => {
    if (!streamEnabled) return;
    let source: EventSource;
    try {
      source = new EventSource("/api/desktop/stream");
    } catch {
      return;
    }
    const onOverview = (event: Event) => {
      try {
        const payload = JSON.parse((event as MessageEvent).data) as { overview?: DesktopOverview };
        if (payload?.overview) ingest(payload.overview);
      } catch {
        /* payload rusak — biarkan poll berikutnya yang mengoreksi */
      }
    };
    source.addEventListener("overview", onOverview);
    return () => {
      source.removeEventListener("overview", onOverview);
      source.close();
    };
  }, [streamEnabled, ingest]);

  return { history: state.history, popups: state.popups, ingest, dismiss, clear };
}
