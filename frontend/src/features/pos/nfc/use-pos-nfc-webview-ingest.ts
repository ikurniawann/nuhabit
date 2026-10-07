"use client";

import { useEffect, useRef } from "react";

type ScanHandler = (uid: string) => void;

type ReaderInfo = {
  name: string | null;
  source: string;
};

declare global {
  interface Window {
    arkivNfc?: {
      onScan: (handler: ScanHandler) => () => void;
      getReaderInfo: () => ReaderInfo;
    };
    nfc?: {
      onScan?: (handler: ScanHandler) => () => void;
      getReaderInfo?: () => ReaderInfo;
    };
    __posMockEmitNfcScan?: ScanHandler;
    __posMockOpenScanDialog?: ScanHandler;
    __posMockPendingScans?: string[];
  }
}

function getEventUid(event: Event) {
  const detail = (event as CustomEvent<{ uid?: unknown }>).detail;
  return typeof detail?.uid === "string" ? detail.uid : "";
}

/**
 * Accepts NFC scans injected by Android WebView or the POS mock trial contract.
 * The callback receives the raw UID; route-level consumers own normalization.
 */
export function usePosNfcWebViewIngest(onCard: (uid: string) => void) {
  const onCardRef = useRef(onCard);

  useEffect(() => {
    onCardRef.current = onCard;
  }, [onCard]);

  useEffect(() => {
    const callbacks = new Set<ScanHandler>();
    const emit = (uid: string) => {
      if (!uid) return;
      callbacks.forEach((callback) => callback(uid));
      onCardRef.current(uid);
    };

    let unsubscribeArkiv: (() => void) | undefined;
    const existingArkivNfc = window.arkivNfc;
    const createdArkivNfc = !existingArkivNfc;
    if (createdArkivNfc) {
      window.arkivNfc = {
        onScan(handler) {
          callbacks.add(handler);
          return () => callbacks.delete(handler);
        },
        getReaderInfo() {
          const externalInfo = window.nfc?.getReaderInfo?.();
          return externalInfo ?? { name: "NüHabit WebView NFC", source: "webview" };
        },
      };
    } else {
      unsubscribeArkiv = existingArkivNfc.onScan(emit);
    }

    const unsubscribeExternal = window.nfc?.onScan?.((uid) => emit(uid));

    const createdEmitAlias = !window.__posMockEmitNfcScan;
    if (createdEmitAlias) {
      window.__posMockEmitNfcScan = emit;
    }

    const createdDialogAlias = !window.__posMockOpenScanDialog;
    if (createdDialogAlias) {
      window.__posMockOpenScanDialog = emit;
    }

    function onArkivScan(event: Event) {
      emit(getEventUid(event));
    }

    function onPosMockScan(event: Event) {
      emit(getEventUid(event));
    }

    window.addEventListener("arkiv-nfc-scan", onArkivScan);
    window.addEventListener("pos-mock-nfc-scan", onPosMockScan);

    const pending = window.__posMockPendingScans;
    if (Array.isArray(pending) && pending.length > 0) {
      pending.splice(0).forEach((uid) => emit(uid));
    }

    return () => {
      unsubscribeArkiv?.();
      unsubscribeExternal?.();
      window.removeEventListener("arkiv-nfc-scan", onArkivScan);
      window.removeEventListener("pos-mock-nfc-scan", onPosMockScan);
      callbacks.clear();
      if (createdEmitAlias) {
        delete window.__posMockEmitNfcScan;
      }
      if (createdDialogAlias) {
        delete window.__posMockOpenScanDialog;
      }
      if (createdArkivNfc) {
        delete window.arkivNfc;
      }
    };
  }, []);
}
