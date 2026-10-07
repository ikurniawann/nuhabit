"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircleIcon, XCircleIcon } from "@heroicons/react/24/solid";
import { normalizeNfcUid } from "@/features/pos/nfc";
import { usePosNfcBridge } from "@/features/pos/nfc/use-pos-nfc-bridge";
import { usePosNfcWebViewIngest } from "@/features/pos/nfc/use-pos-nfc-webview-ingest";
import { formatRupiah } from "@/lib/format";
import { gateTap } from "../api";
import type { GateTapResponse } from "../types";

const RESULT_RESET_MS = 6000;
const TAP_DEBOUNCE_MS = 1200;

interface TapLogItem {
  at: string;
  uid: string;
  response: GateTapResponse;
}

/**
 * Mode Gate fullscreen — tablet + reader NFC di gate masuk. Dua jalur scan:
 * PC/SC bridge (WebSocket lokal) dan keyboard wedge (input tersembunyi yang
 * selalu difokuskan ulang). Tap → hijau/merah + identitas rombongan.
 */
export function GatePage() {
  const [current, setCurrent] = useState<GateTapResponse | null>(null);
  const [log, setLog] = useState<TapLogItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [wedgeValue, setWedgeValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const lastTapRef = useRef(0);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleTap = useCallback(async (uid: string) => {
    const trimmed = normalizeNfcUid(uid);
    if (!trimmed) return;
    const now = Date.now();
    if (now - lastTapRef.current < TAP_DEBOUNCE_MS) return;
    lastTapRef.current = now;

    setBusy(true);
    try {
      const response = await gateTap({ nfc_uid: trimmed });
      setCurrent(response);
      setLog((prev) => [
        { at: new Date().toISOString(), uid: trimmed, response },
        ...prev.slice(0, 19),
      ]);
    } catch (err) {
      setCurrent({
        result: "error",
        ok: false,
        reason: err instanceof Error ? err.message : "Gagal memproses tap",
      });
    } finally {
      setBusy(false);
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
      resetTimerRef.current = setTimeout(() => setCurrent(null), RESULT_RESET_MS);
    }
  }, []);

  usePosNfcBridge(handleTap);
  usePosNfcWebViewIngest(handleTap);

  // Wedge: jaga fokus di input tersembunyi supaya ketikan reader tertangkap
  useEffect(() => {
    const interval = setInterval(() => {
      if (document.activeElement !== inputRef.current) {
        inputRef.current?.focus();
      }
    }, 1500);
    return () => {
      clearInterval(interval);
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    };
  }, []);

  const isIdle = current === null;
  const bgClass = isIdle
    ? "bg-gray-900"
    : current.ok
      ? "bg-emerald-600"
      : "bg-red-600";

  return (
    <div
      className={`flex min-h-[calc(100vh-4rem)] flex-col items-center justify-center rounded-2xl px-6 py-10 text-white transition-colors duration-300 ${bgClass}`}
      onClick={() => inputRef.current?.focus()}
    >
      <input
        ref={inputRef}
        autoFocus
        value={wedgeValue}
        onChange={(e) => setWedgeValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            const uid = wedgeValue;
            setWedgeValue("");
            void handleTap(uid);
          }
        }}
        className="pointer-events-none absolute h-0 w-0 opacity-0"
        aria-hidden
        tabIndex={-1}
      />

      {isIdle ? (
        <div className="text-center">
          <div className="mx-auto mb-6 flex h-28 w-28 items-center justify-center rounded-full border-4 border-white/30">
            <span className="text-5xl">📶</span>
          </div>
          <h1 className="text-4xl font-bold">
            {busy ? "Memproses…" : "Tap Gelang di Reader"}
          </h1>
          <p className="mt-3 text-lg text-white/70">
            Gate masuk — tiket ter-charge otomatis saat tap pertama
          </p>
        </div>
      ) : (
        <div className="text-center">
          {current.ok ? (
            <CheckCircleIcon className="mx-auto mb-4 h-32 w-32" />
          ) : (
            <XCircleIcon className="mx-auto mb-4 h-32 w-32" />
          )}
          <h1 className="text-5xl font-bold">
            {current.ok
              ? current.result === "masuk-lagi"
                ? "SILAKAN MASUK KEMBALI"
                : current.result === "masuk-karyawan"
                  ? "SELAMAT BEKERJA"
                  : "SELAMAT DATANG"
              : "DITOLAK"}
          </h1>
          {current.contact_name ? (
            <p className="mt-4 text-2xl">
              {/* Anggota rombongan booking tampil dgn namanya sendiri */}
              {current.guest_name ?? current.contact_name}
              {current.ticket_type_name ? ` · ${current.ticket_type_name}` : ""}
              {current.guest_name && current.guest_name !== current.contact_name
                ? ` (rombongan ${current.contact_name})`
                : ""}
            </p>
          ) : null}
          {current.ok && current.charged_amount ? (
            <p className="mt-2 text-xl text-white/80">
              Tiket {formatRupiah(current.charged_amount)} tercatat di tab
            </p>
          ) : null}
          {!current.ok && current.reason ? (
            <p className="mx-auto mt-3 max-w-xl text-xl text-white/90">
              {current.reason}
            </p>
          ) : null}
        </div>
      )}

      {log.length > 0 ? (
        <div className="mt-10 w-full max-w-2xl">
          <p className="mb-2 text-xs uppercase tracking-wide text-white/50">
            Tap terakhir
          </p>
          <div className="space-y-1">
            {log.slice(0, 5).map((item) => (
              <div
                key={`${item.at}-${item.uid}`}
                className="flex items-center gap-3 rounded-lg bg-white/10 px-3 py-1.5 text-sm"
              >
                <span
                  className={`h-2 w-2 rounded-full ${
                    item.response.ok ? "bg-emerald-300" : "bg-red-300"
                  }`}
                />
                <span className="font-mono text-xs">{item.uid}</span>
                <span className="text-white/80">
                  {item.response.contact_name ?? "—"}
                </span>
                <span className="ml-auto text-xs text-white/60">
                  {item.response.result}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
