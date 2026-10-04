"use client";

import { useState } from "react";
import { Coins, Loader2, LogOut, Sparkles, UserRound } from "lucide-react";
import { idrToArkDisplay } from "@/lib/pos/loyalty-settings";
import {
  ApiRequestError,
  logoutMember,
  requestOtp,
  tryDevBypassLogin,
  verifyOtp,
  type MemberProfile,
} from "../api";
import { BottomSheet } from "./sheet";
import { formatNumber } from "@/lib/format";

/**
 * Masuk member via OTP WhatsApp — memakai endpoint portal member yang sudah
 * ada (/api/member-portal/otp → /verify → cookie member_session). Nomor yang
 * belum terdaftar tidak bisa daftar dari sini (kebijakan EPIC-011 Fase D:
 * daftar di kasir) → ditawarkan lanjut sebagai tamu.
 */
export function MemberSheet({
  open,
  member,
  onClose,
  onChanged,
  arkEnabled = true,
  xpEnabled = true,
}: {
  arkEnabled?: boolean;
  xpEnabled?: boolean;
  open: boolean;
  member: MemberProfile | null;
  onClose: () => void;
  /** Dipanggil setelah login/logout berhasil supaya induk memuat ulang profil. */
  onChanged: () => Promise<void> | void;
}) {
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notRegistered, setNotRegistered] = useState(false);
  const [info, setInfo] = useState<string | null>(null);

  function reset() {
    setStep("phone");
    setCode("");
    setError(null);
    setNotRegistered(false);
    setInfo(null);
  }

  async function sendCode() {
    const value = phone.trim();
    if (value.replace(/\D/g, "").length < 9) {
      setError("Masukkan nomor WhatsApp yang valid");
      return;
    }
    setBusy(true);
    setError(null);
    setNotRegistered(false);
    try {
      if (await tryDevBypassLogin(value)) {
        await onChanged();
        reset();
        onClose();
        return;
      }
      const result = await requestOtp(value);
      setStep("code");
      setInfo(
        result.wa_delivered === false
          ? "Kode dibuat tetapi WhatsApp gagal terkirim — hubungi kasir."
          : "Kode OTP dikirim ke WhatsApp Anda."
      );
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 404) {
        setNotRegistered(true);
      }
      setError(err instanceof Error ? err.message : "Gagal mengirim kode");
    } finally {
      setBusy(false);
    }
  }

  async function submitCode() {
    const value = code.trim();
    if (!/^\d{6}$/.test(value)) {
      setError("Kode harus 6 digit");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await verifyOtp(phone.trim(), value);
      await onChanged();
      reset();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kode salah");
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    setBusy(true);
    try {
      await logoutMember();
      await onChanged();
      reset();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <BottomSheet
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title={member ? "Akun member" : "Masuk member"}
    >
      {member ? (
        <div>
          <div className="flex items-center gap-3 rounded-2xl bg-primary/5 p-4">
            <div className="flex size-12 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <UserRound className="size-6" />
            </div>
            <div className="min-w-0">
              <div className="truncate text-base font-bold text-gray-900">{member.name}</div>
              <div className="text-xs text-gray-600">
                {member.tier ? `${member.tier.name} · ` : ""}
                {member.phone}
              </div>
            </div>
          </div>
          {(arkEnabled || xpEnabled) && (
          <div className={`mt-3 grid gap-3 ${arkEnabled && xpEnabled ? "grid-cols-2" : "grid-cols-1"}`}>
            {arkEnabled && (
            <div className="rounded-2xl border border-gray-200 p-3">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-500">
                <Coins className="size-3.5 text-amber-500" /> Saldo ARK Coin
              </div>
              <div className="mt-1 text-lg font-bold text-gray-900">
                {idrToArkDisplay(member.ark_coin_balance, member.ark_rate)}
              </div>
            </div>
            )}
            {xpEnabled && (
            <div className="rounded-2xl border border-gray-200 p-3">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-500">
                <Sparkles className="size-3.5 text-amber-500" /> Total XP
              </div>
              <div className="mt-1 text-lg font-bold text-gray-900">
                {formatNumber(member.total_xp)}
              </div>
            </div>
            )}
          </div>
          )}
          {(arkEnabled || xpEnabled) && (
            <p className="mt-3 text-xs leading-relaxed text-gray-500">
              {xpEnabled ? "XP dari pesanan ini masuk ke akun Anda setelah pembayaran lunas. " : ""}
              {arkEnabled ? "ARK Coin bisa dipakai langsung di langkah pembayaran." : ""}
            </p>
          )}
          <button
            type="button"
            onClick={logout}
            disabled={busy}
            className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-gray-200 text-sm font-semibold text-gray-700"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <LogOut className="size-4" />}
            Keluar
          </button>
        </div>
      ) : step === "phone" ? (
        <div>
          <p className="text-sm leading-relaxed text-gray-600">
            Masukkan nomor WhatsApp yang terdaftar sebagai member
            {xpEnabled && arkEnabled
              ? " untuk kumpulkan XP dan bayar dengan ARK Coin."
              : xpEnabled
                ? " untuk kumpulkan XP."
                : arkEnabled
                  ? " untuk bayar dengan ARK Coin."
                  : " untuk menikmati benefit member."}
          </p>
          <label className="mt-4 block">
            <span className="text-xs font-semibold text-gray-700">Nomor WhatsApp</span>
            <input
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              inputMode="tel"
              autoComplete="tel"
              placeholder="08xxxxxxxxxx"
              className="mt-1.5 h-12 w-full rounded-xl border border-gray-200 px-4 text-base font-semibold text-gray-900 outline-none focus:border-primary focus:ring-4 focus:ring-primary/10"
            />
          </label>
          {error && (
            <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}
          {notRegistered && (
            <button
              type="button"
              onClick={() => {
                reset();
                onClose();
              }}
              className="mt-3 h-11 w-full rounded-xl border border-gray-200 text-sm font-semibold text-gray-700"
            >
              Lanjut sebagai tamu
            </button>
          )}
          <button
            type="button"
            onClick={sendCode}
            disabled={busy}
            className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-bold text-primary-foreground disabled:opacity-60"
          >
            {busy && <Loader2 className="size-4 animate-spin" />}
            Kirim kode OTP
          </button>
        </div>
      ) : (
        <div>
          <p className="text-sm leading-relaxed text-gray-600">
            {info || "Kode OTP dikirim ke WhatsApp Anda."} Berlaku 5 menit.
          </p>
          <label className="mt-4 block">
            <span className="text-xs font-semibold text-gray-700">Kode 6 digit</span>
            <input
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="••••••"
              className="mt-1.5 h-12 w-full rounded-xl border border-gray-200 px-4 text-center text-2xl font-bold tracking-[0.5em] text-gray-900 outline-none focus:border-primary focus:ring-4 focus:ring-primary/10"
            />
          </label>
          {error && (
            <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}
          <button
            type="button"
            onClick={submitCode}
            disabled={busy}
            className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-bold text-primary-foreground disabled:opacity-60"
          >
            {busy && <Loader2 className="size-4 animate-spin" />}
            Masuk
          </button>
          <button
            type="button"
            onClick={() => {
              setStep("phone");
              setCode("");
              setError(null);
            }}
            className="mt-2 h-10 w-full text-sm font-semibold text-gray-500"
          >
            Ganti nomor
          </button>
        </div>
      )}
    </BottomSheet>
  );
}
