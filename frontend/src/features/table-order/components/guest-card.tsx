"use client";

import { forwardRef, useState } from "react";
import { KeyRound, Loader2, Pencil, Phone, UserRound } from "lucide-react";
import { displayGuestPhone, validateGuest, type GuestIdentity } from "@/lib/table-order/guest";
import { ApiRequestError, requestOtp, tryDevBypassLogin, verifyOtp, type MemberProfile } from "../api";
import { OTP_ENABLED } from "@/lib/otp-availability";

/**
 * Kartu "Data pemesan" — nomor WhatsApp & nama WAJIB sebelum memesan
 * (owner 2026-09-28). Member yang login OTP otomatis memenuhi syarat.
 * Nomor yang ternyata terdaftar sbg member → OTP WhatsApp langsung dikirim
 * & kolom kode muncul di kartu ini; bukan member (404) → lanjut sbg tamu.
 * `coach` = sorotan pertama kali buka: kartu di atas overlay + tooltip.
 */
export const GuestCard = forwardRef<
  HTMLDivElement,
  {
    guest: GuestIdentity | null;
    member: MemberProfile | null;
    coach: boolean;
    onSave: (guest: GuestIdentity) => void;
    /** Login member berhasil (OTP) → induk memuat ulang profil member. */
    onMemberLogin: () => Promise<void> | void;
    onOpenMember: () => void;
    onDismissCoach: () => void;
  }
>(function GuestCard({ guest, member, coach, onSave, onMemberLogin, onOpenMember, onDismissCoach }, ref) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(guest?.name ?? "");
  const [phone, setPhone] = useState(guest?.phone ? `0${guest.phone.slice(2)}` : "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Nomor terdaftar member → menunggu kode OTP. */
  const [otpFor, setOtpFor] = useState<GuestIdentity | null>(null);
  const [code, setCode] = useState("");
  const [info, setInfo] = useState<string | null>(null);

  function continueAsGuest(next: GuestIdentity) {
    setOtpFor(null);
    setEditing(false);
    onSave(next);
  }

  async function save() {
    const result = validateGuest({ name, phone });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    if (!OTP_ENABLED) { continueAsGuest(result.guest); return; }
    setBusy(true);
    try {
      if (await tryDevBypassLogin(result.guest.phone)) {
        await onMemberLogin();
        return;
      }
      const sent = await requestOtp(result.guest.phone);
      setOtpFor(result.guest);
      setCode("");
      setInfo(
        sent.wa_delivered === false
          ? "Nomor ini terdaftar sebagai member, tetapi kode OTP gagal terkirim ke WhatsApp. Lanjut sebagai tamu atau coba lagi."
          : "Nomor ini terdaftar sebagai member 🎉 Kode OTP sudah dikirim ke WhatsApp Anda."
      );
    } catch (err) {
      // 404 = bukan member → tamu. Error lain (mis. terlalu sering minta OTP)
      // tidak boleh menghalangi pesanan → tetap lanjut sebagai tamu.
      if (!(err instanceof ApiRequestError && err.status === 404)) {
        console.warn("[self-order] cek member gagal:", err);
      }
      continueAsGuest(result.guest);
    } finally {
      setBusy(false);
    }
  }

  async function submitCode() {
    if (!otpFor) return;
    if (!/^\d{6}$/.test(code.trim())) {
      setError("Kode OTP harus 6 digit");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await verifyOtp(otpFor.phone, code.trim());
      setOtpFor(null);
      await onMemberLogin();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kode OTP salah");
    } finally {
      setBusy(false);
    }
  }

  const showForm = !member && (!guest || editing);

  return (
    <div ref={ref} className={`relative scroll-mt-24 px-4 ${coach ? "z-50" : ""}`}>
      {coach && (
        <div className="absolute -top-2 left-4 right-4 -translate-y-full" role="tooltip">
          <div className="rounded-2xl bg-white px-4 py-3 text-sm shadow-xl">
            <div className="font-bold text-gray-900">👋 Mulai dari sini</div>
            <p className="mt-0.5 text-xs leading-relaxed text-gray-600">
              Isi nomor WhatsApp & nama dulu sebelum memesan — dipakai untuk memanggil & mengonfirmasi pesanan Anda.
            </p>
            <button type="button" onClick={onDismissCoach} className="mt-1.5 text-xs font-semibold text-brand-text">
              Lihat menu dulu
            </button>
          </div>
          <div className="ml-8 size-3 -translate-y-1.5 rotate-45 bg-white" />
        </div>
      )}

      <div className={`rounded-2xl bg-white p-4 shadow-sm ${coach ? "ring-4 ring-primary/60" : "ring-1 ring-gray-200"}`}>
        {member ? (
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-full bg-primary/10 text-brand-text">
              <UserRound className="size-4" />
            </div>
            <div className="min-w-0 text-sm">
              <div className="font-bold text-gray-900">{member.name}</div>
              <div className="text-xs text-gray-500">Member · {member.phone}</div>
            </div>
          </div>
        ) : otpFor ? (
          <div>
            <div className="flex items-center gap-2 text-sm font-bold text-gray-900">
              <KeyRound className="size-4 text-brand-text" /> Masuk sebagai member
            </div>
            <p className="mt-1 text-xs leading-relaxed text-gray-600">{info}</p>
            <p className="mt-1 text-xs text-gray-500">WA {displayGuestPhone(otpFor.phone)}</p>
            <input
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
              onKeyDown={(event) => event.key === "Enter" && void submitCode()}
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              placeholder="Kode OTP 6 digit"
              className="mt-3 h-11 w-full rounded-xl border border-gray-200 px-4 text-center text-lg font-bold tracking-[0.4em] outline-none focus:border-primary"
            />
            {error && <p className="mt-2 text-xs font-semibold text-red-600">{error}</p>}
            <button
              type="button"
              disabled={busy}
              onClick={() => void submitCode()}
              className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-bold text-primary-foreground shadow-sm disabled:opacity-60"
            >
              {busy && <Loader2 className="size-4 animate-spin" />} Verifikasi & masuk
            </button>
            <div className="mt-2 flex justify-between text-xs font-semibold">
              <button type="button" onClick={() => setOtpFor(null)} className="text-gray-500">
                Ganti nomor
              </button>
              <button type="button" onClick={() => continueAsGuest(otpFor)} className="text-brand-text">
                Lanjut sebagai tamu
              </button>
            </div>
          </div>
        ) : showForm ? (
          <div>
            <div className="text-sm font-bold text-gray-900">Data pemesan</div>
            <p className="text-xs text-gray-500">Wajib diisi sebelum memesan.</p>
            <div className="mt-3 space-y-2">
              <label className="flex h-11 items-center gap-2 rounded-xl border border-gray-200 px-3 focus-within:border-primary">
                <Phone className="size-4 shrink-0 text-gray-400" />
                <input
                  id="guest-phone"
                  value={phone}
                  onChange={(event) => setPhone(event.target.value.slice(0, 20))}
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="Nomor WhatsApp (0812…)"
                  className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none"
                />
              </label>
              <label className="flex h-11 items-center gap-2 rounded-xl border border-gray-200 px-3 focus-within:border-primary">
                <UserRound className="size-4 shrink-0 text-gray-400" />
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value.slice(0, 80))}
                  onKeyDown={(event) => event.key === "Enter" && void save()}
                  autoComplete="name"
                  placeholder="Nama untuk dipanggil"
                  className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none"
                />
              </label>
            </div>
            {error && <p className="mt-2 text-xs font-semibold text-red-600">{error}</p>}
            <button
              type="button"
              onClick={() => void save()}
              disabled={busy}
              className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-bold text-primary-foreground shadow-sm active:scale-[0.99] disabled:opacity-60"
            >
              {busy && <Loader2 className="size-4 animate-spin" />}
              Simpan & mulai pesan
            </button>
            {OTP_ENABLED ? <button type="button" onClick={onOpenMember} className="mt-2 w-full text-center text-xs font-semibold text-brand-text">
              Sudah member? Masuk dengan OTP
            </button> : null}
          </div>
        ) : guest ? (
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex size-9 items-center justify-center rounded-full bg-primary/10 text-brand-text">
                <UserRound className="size-4" />
              </div>
              <div className="min-w-0 text-sm">
                <div className="truncate font-bold text-gray-900">{guest.name}</div>
                <div className="text-xs text-gray-500">WA {displayGuestPhone(guest.phone)}</div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setName(guest.name);
                setPhone(`0${guest.phone.slice(2)}`);
                setEditing(true);
              }}
              className="inline-flex items-center gap-1 text-xs font-semibold text-brand-text"
            >
              <Pencil className="size-3.5" /> Ubah
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
});
