"use client";

import { useEffect, useRef } from "react";
import { parseBridgeMessage } from "./parse-bridge-message";

export const POS_NFC_BRIDGE_WS_URL =
  process.env.NEXT_PUBLIC_POS_NFC_BRIDGE_WS ?? "ws://127.0.0.1:8787";

/**
 * Connects to the local PC/SC bridge and invokes onCard for each insert edge.
 */
export function usePosNfcBridge(onCard: (uid: string) => void) {
  const onCardRef = useRef(onCard);

  useEffect(() => {
    onCardRef.current = onCard;
  }, [onCard]);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let closed = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;

    function connect() {
      if (closed) return;
      try {
        ws = new WebSocket(POS_NFC_BRIDGE_WS_URL);
      } catch {
        scheduleRetry();
        return;
      }

      ws.onopen = () => {
        attempt = 0;
      };

      ws.onmessage = (event) => {
        const msg = parseBridgeMessage(String(event.data));
        if (msg.kind === "card") {
          onCardRef.current(msg.uid);
        }
      };

      ws.onclose = () => {
        ws = null;
        scheduleRetry();
      };

      ws.onerror = () => {
        ws?.close();
      };
    }

    function scheduleRetry() {
      if (closed) return;
      const delay = Math.min(10_000, 1000 * 2 ** Math.min(attempt, 3));
      attempt += 1;
      retryTimer = setTimeout(connect, delay);
    }

    connect();

    return () => {
      closed = true;
      if (retryTimer) clearTimeout(retryTimer);
      ws?.close();
    };
  }, []);
}
