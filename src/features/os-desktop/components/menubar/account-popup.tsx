"use client";

import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { brandOsName } from "@/lib/branding";
import { signOut } from "@/lib/auth/client";
import type { OsUserAccount } from "../../hooks/use-desktop-account";

export function AccountPopup({
  account,
  onClose,
  onLogin,
  onDashboard,
  onLock,
}: {
  account: OsUserAccount | null;
  onClose: () => void;
  onLogin: () => void;
  onDashboard: () => void;
  onLock: () => void;
}) {
  const brandOs = brandOsName();
  const router = useRouter();

  const logout = async () => {
    await signOut();
    router.push("/login");
  };

  return (
    <div className="fixed inset-0 z-[80] bg-black/25 backdrop-blur-sm" onClick={onClose}>
      <div
        className="absolute left-1/2 top-1/2 w-[min(360px,calc(100vw-24px))] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-3xl border border-white/18 bg-slate-950/75 text-white shadow-2xl backdrop-blur-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold">Account</h2>
            <p className="text-xs text-white/50">{brandOs} session</p>
          </div>
          <button onClick={onClose} className="rounded-full p-2 text-white/55 transition hover:bg-white/10 hover:text-white">
            <X className="size-4" />
          </button>
        </div>

        <div className="p-5">
          <div className="rounded-3xl border border-white/10 bg-white/8 p-4 text-center">
            <div className="mx-auto mb-3 grid size-14 place-items-center rounded-full bg-accent text-accent-foreground text-lg font-bold shadow-lg">
              {account ? account.fullName.slice(0, 1).toUpperCase() : "G"}
            </div>
            <div className="font-semibold">{account ? account.fullName : "Guest"}</div>
            <div className="mt-1 text-sm text-white/55">{account ? account.email : "Not logged in"}</div>
            <div className="mt-3 inline-flex rounded-full border border-white/10 bg-white/10 px-3 py-1 text-xs font-semibold capitalize text-pink-100">
              {account ? account.role.replace("_", " ") : "public access"}
            </div>
          </div>

          <div className="mt-4 grid gap-2">
            {account ? (
              <>
                <button onClick={onDashboard} className="rounded-2xl bg-pink-600 px-4 py-3 text-sm font-semibold transition hover:bg-pink-500">
                  Go to Dashboard
                </button>
                <button onClick={onLock} className="rounded-2xl border border-white/15 bg-white/8 px-4 py-3 text-sm font-semibold text-white/85 transition hover:bg-white/12">
                  Kunci Layar <span className="text-white/45">⌘⇧L</span>
                </button>
                <button onClick={() => void logout()} className="rounded-2xl border border-white/15 bg-white/8 px-4 py-3 text-sm font-semibold text-white/85 transition hover:bg-white/12">
                  Keluar / Ganti user
                </button>
              </>
            ) : (
              <button onClick={onLogin} className="rounded-2xl bg-pink-600 px-4 py-3 text-sm font-semibold transition hover:bg-pink-500">
                Log In to {brandOs}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
