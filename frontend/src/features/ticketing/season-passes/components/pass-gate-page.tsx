"use client";

// EPIC-028 Fase C — layar validasi Season Pass di gate / reader keliling.
// Reader QR/NFC (keyboard-wedge: ketik + Enter) tertangkap input tersembunyi
// yang selalu di-fokus; bisa juga ketik manual kode pass. Hasil: HIJAU
// (granted) / MERAH (denied) dengan alasan.

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Loader2, ScanLine, XCircle } from "lucide-react";
import { passGateTap } from "../api";
import { ENTRY_POLICY_LABEL, type PassGateResult } from "../types";

const TAP_DEBOUNCE_MS = 800;

const DENIED_TITLE: Record<string, string> = {
  denied_expired: "Kedaluwarsa",
  denied_duplicate: "Sudah masuk hari ini",
  denied_quota: "Jatah habis",
  denied_inactive: "Tidak aktif",
  denied_blackout: "Tanggal blackout",
  "bukan-pass": "Bukan pass",
};

export function PassGatePage() {
  const [current, setCurrent] = useState<PassGateResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [wedge, setWedge] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const lastRef = useRef(0);

  const submit = useCallback(async (raw: string) => {
    const code = raw.trim();
    if (!code) return;
    const now = Date.now();
    if (now - lastRef.current < TAP_DEBOUNCE_MS) return;
    lastRef.current = now;
    setBusy(true);
    try {
      const res = await passGateTap(code);
      setCurrent(res);
    } catch (err) {
      setCurrent({
        ok: false,
        result: "bukan-pass",
        reason: err instanceof Error ? err.message : "Gagal memproses",
      });
    } finally {
      setBusy(false);
      setWedge("");
    }
  }, []);

  // Jaga fokus di input tersembunyi supaya reader wedge tertangkap
  useEffect(() => {
    const id = setInterval(() => {
      if (document.activeElement !== inputRef.current) inputRef.current?.focus();
    }, 400);
    return () => clearInterval(id);
  }, []);

  const granted = current?.ok === true;
  const bg = !current
    ? "bg-gray-900"
    : granted
      ? "bg-emerald-600"
      : "bg-rose-600";

  return (
    <div
      className={`flex min-h-dvh flex-col items-center justify-center px-6 text-center text-white transition-colors ${bg}`}
      onClick={() => inputRef.current?.focus()}
    >
      <input
        ref={inputRef}
        value={wedge}
        onChange={(e) => setWedge(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit(wedge);
        }}
        className="absolute h-px w-px opacity-0"
        aria-hidden
        autoFocus
      />

      {busy ? (
        <Loader2 className="h-16 w-16 animate-spin" />
      ) : !current ? (
        <>
          <ScanLine className="h-20 w-20 opacity-80" />
          <h1 className="mt-4 text-3xl font-bold">Scan Season Pass</h1>
          <p className="mt-2 text-white/70">
            Arahkan QR pass ke reader, tap gelang NFC, atau ketik kode pass.
          </p>
        </>
      ) : granted ? (
        <>
          <CheckCircle2 className="h-24 w-24" />
          <h1 className="mt-4 text-5xl font-bold">MASUK</h1>
          <p className="mt-3 text-2xl font-semibold">{current.holder_name}</p>
          <p className="mt-1 text-white/80">{current.ticket_type_name}</p>
          <p className="mt-1 font-mono text-sm text-white/70">
            {current.pass_code}
          </p>
          <div className="mt-3 flex flex-wrap justify-center gap-2 text-sm">
            {current.entry_policy && (
              <span className="rounded-full bg-white/20 px-3 py-1">
                {ENTRY_POLICY_LABEL[current.entry_policy]}
              </span>
            )}
            {current.remaining_quota !== undefined && (
              <span className="rounded-full bg-white/20 px-3 py-1">
                Sisa {current.remaining_quota}× kunjungan
              </span>
            )}
            {current.valid_until && (
              <span className="rounded-full bg-white/20 px-3 py-1">
                s/d {current.valid_until}
              </span>
            )}
          </div>
        </>
      ) : (
        <>
          <XCircle className="h-24 w-24" />
          <h1 className="mt-4 text-4xl font-bold">DITOLAK</h1>
          <p className="mt-2 text-2xl font-semibold">
            {DENIED_TITLE[current.result] ?? "Ditolak"}
          </p>
          {current.reason && (
            <p className="mt-2 max-w-md text-white/85">{current.reason}</p>
          )}
          {current.holder_name && (
            <p className="mt-2 text-sm text-white/70">
              {current.holder_name} · {current.pass_code}
            </p>
          )}
        </>
      )}

      {current && !busy && (
        <button
          type="button"
          onClick={() => {
            setCurrent(null);
            inputRef.current?.focus();
          }}
          className="mt-8 rounded-xl bg-white/20 px-6 py-2.5 text-sm font-semibold hover:bg-white/30"
        >
          Scan berikutnya
        </button>
      )}
    </div>
  );
}
