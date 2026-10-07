"use client";

import { useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import type { OsUserAccount } from "../../hooks/use-desktop-account";

async function verifyPassword(email: string, password: string) {
  const res = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error("Kata sandi salah");
}

/**
 * Kunci layar: perangkat kasir/tablet sering dipakai bergantian. Membuka
 * kunci = login ulang ke server (bukan sekadar cocokkan string di klien),
 * jadi sesi yang sudah kedaluwarsa ikut ketahuan di sini.
 */
export function LockScreen({
  account,
  onUnlock,
  onSwitchUser,
}: {
  account: OsUserAccount;
  onUnlock: () => void;
  onSwitchUser: () => void;
}) {
  const [password, setPassword] = useState("");
  const unlock = useMutation({
    mutationFn: () => verifyPassword(account.email, password),
    retry: false,
    onSuccess: () => {
      setPassword("");
      onUnlock();
    },
  });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!password || unlock.isPending) return;
    unlock.mutate();
  };

  return (
    <div className="fixed inset-0 z-[200] grid place-items-center bg-slate-950/80 backdrop-blur-2xl">
      <div className="w-[min(380px,calc(100vw-32px))] text-center text-white">
        <div className="mx-auto mb-4 grid size-20 place-items-center rounded-full bg-accent text-accent-foreground text-2xl font-bold shadow-2xl">
          {account.fullName.slice(0, 1).toUpperCase()}
        </div>
        <div className="text-lg font-semibold">{account.fullName}</div>
        <div className="mt-1 text-sm text-white/55">{account.email}</div>
        <form onSubmit={submit} className="mt-6">
          <input
            autoFocus
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Kata sandi"
            className="h-12 w-full rounded-2xl border border-white/18 bg-white/10 px-4 text-center text-base outline-none placeholder:text-white/40 focus:border-pink-200/60"
          />
          {unlock.error && <div className="mt-2 text-sm text-rose-300">{unlock.error.message || "Kata sandi salah"}</div>}
          <button
            type="submit"
            disabled={unlock.isPending || !password}
            className="mt-3 h-12 w-full rounded-2xl bg-pink-600 text-sm font-semibold transition hover:bg-pink-500 disabled:opacity-50"
          >
            {unlock.isPending ? "Membuka…" : "Buka Kunci"}
          </button>
        </form>
        <button
          type="button"
          onClick={onSwitchUser}
          className="mt-4 text-sm text-white/55 underline-offset-4 transition hover:text-white hover:underline"
        >
          Ganti user
        </button>
      </div>
    </div>
  );
}
