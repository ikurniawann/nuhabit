"use client";

import { useCallback, useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { usePosNfc } from "./pos-nfc-context";
import { routePosNfcCard } from "./route-card-scan";
import { normalizeNfcUid } from "@/lib/pos/nfc-uid";
import { createWedgeBuffer, reduceWedgeKey } from "./wedge-buffer";
import { shouldIgnoreWedgeKeydown } from "./wedge-target";
import { usePosNfcBridge } from "./use-pos-nfc-bridge";
import { usePosNfcWebViewIngest } from "./use-pos-nfc-webview-ingest";

const DEBOUNCE_MS = 1000;

export function PosNfcScanListener() {
  const pathname = usePathname();
  const router = useRouter();
  const { paymentNfcActive } = usePosNfc();
  const bufferRef = useRef(createWedgeBuffer());
  const lastCommitAtRef = useRef(0);
  const paymentNfcActiveRef = useRef(paymentNfcActive);
  const pathnameRef = useRef(pathname);

  useEffect(() => {
    paymentNfcActiveRef.current = paymentNfcActive;
  }, [paymentNfcActive]);

  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  const handleCard = useCallback(
    (card: string) => {
      const normalized = normalizeNfcUid(card);
      if (!normalized) return;

      const now = Date.now();
      if (now - lastCommitAtRef.current < DEBOUNCE_MS) return;
      lastCommitAtRef.current = now;

      routePosNfcCard({
        card: normalized,
        pathname: pathnameRef.current,
        paymentNfcActive: paymentNfcActiveRef.current,
        push: (href) => router.push(href),
      });
    },
    [router]
  );

  usePosNfcBridge(handleCard);
  usePosNfcWebViewIngest(handleCard);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      // Ketikan di search produk / form biasa ≠ scan kartu wedge.
      if (shouldIgnoreWedgeKeydown(event.target)) {
        bufferRef.current = createWedgeBuffer();
        return;
      }

      const now = Date.now();
      const next = reduceWedgeKey(bufferRef.current, { key: event.key, now });
      bufferRef.current = next;

      if (!next.committed) return;

      bufferRef.current = createWedgeBuffer();
      event.preventDefault();
      handleCard(next.committed);
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleCard]);

  return null;
}
