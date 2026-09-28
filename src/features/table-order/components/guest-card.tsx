"use client";

import { forwardRef, useState } from "react";
import { Pencil, Phone, UserRound } from "lucide-react";
import { displayGuestPhone, validateGuest, type GuestIdentity } from "@/lib/table-order/guest";
import type { MemberProfile } from "../api";

/**
 * Kartu "Data pemesan" — nomor WhatsApp & nama WAJIB sebelum memesan
 * (owner 2026-09-28). Member yang login OTP otomatis memenuhi syarat.
 * `coach` = sorotan pertama kali buka: kartu di atas overlay + tooltip.
 */
export const GuestCard = forwardRef<
  HTMLDivElement,
  {
    guest: GuestIdentity | null;
    member: MemberProfile | null;
    coach: boolean;
    onSave: (guest: GuestIdentity) => void;
    onOpenMember: () => void;
    onDismissCoach: () => void;
  }
>(function GuestCard({ guest, member, coach, onSave, onOpenMember, onDismissCoach }, ref) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(guest?.name ?? "");
  const [phone, setPhone] = useState(guest?.phone ? `0${guest.phone.slice(2)}` : "");
  const [error, setError] = useState<string | null>(null);

  function save() {
    const result = validateGuest({ name, phone });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    setEditing(false);
    onSave(result.guest);
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
            <button type="button" onClick={onDismissCoach} className="mt-1.5 text-xs font-semibold text-primary">
              Lihat menu dulu
            </button>
          </div>
          <div className="ml-8 size-3 -translate-y-1.5 rotate-45 bg-white" />
        </div>
      )}

      <div className={`rounded-2xl bg-white p-4 shadow-sm ${coach ? "ring-4 ring-primary/60" : "ring-1 ring-gray-200"}`}>
        {member ? (
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-full bg-primary/10 text-primary">
              <UserRound className="size-4" />
            </div>
            <div className="min-w-0 text-sm">
              <div className="font-bold text-gray-900">{member.name}</div>
              <div className="text-xs text-gray-500">Member · {member.phone}</div>
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
                  onKeyDown={(event) => event.key === "Enter" && save()}
                  autoComplete="name"
                  placeholder="Nama untuk dipanggil"
                  className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none"
                />
              </label>
            </div>
            {error && <p className="mt-2 text-xs font-semibold text-red-600">{error}</p>}
            <button
              type="button"
              onClick={save}
              className="mt-3 h-11 w-full rounded-xl bg-primary text-sm font-bold text-white shadow-sm active:scale-[0.99]"
            >
              Simpan & mulai pesan
            </button>
            <button type="button" onClick={onOpenMember} className="mt-2 w-full text-center text-xs font-semibold text-primary">
              Sudah member? Masuk dengan OTP
            </button>
          </div>
        ) : guest ? (
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex size-9 items-center justify-center rounded-full bg-primary/10 text-primary">
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
              className="inline-flex items-center gap-1 text-xs font-semibold text-primary"
            >
              <Pencil className="size-3.5" /> Ubah
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
});
