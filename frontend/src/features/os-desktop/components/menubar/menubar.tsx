"use client";

import { Cloud, Command, Search, Wifi } from "lucide-react";
import { formatClockDate, formatClockTime } from "../../lib/format";
import { SystemStatusChip } from "./system-status-chip";

/** Menubar atas: akun, menu cepat, status layanan, dan jam. */
export function Menubar({
  email,
  isLoggedIn,
  now,
  notificationCount,
  onAccount,
  onLogin,
  onApplications,
  onNotifications,
  onWidgets,
  onSearch,
  onToday,
}: {
  email: string | null;
  isLoggedIn: boolean;
  now: Date;
  notificationCount: number;
  onAccount: () => void;
  onLogin: () => void;
  onApplications: () => void;
  onNotifications: () => void;
  onWidgets: () => void;
  onSearch: () => void;
  onToday: () => void;
}) {
  return (
    <header className="fixed inset-x-0 top-0 z-[75] flex h-9 items-center justify-between border-b border-white/10 bg-black/22 px-3 text-[13px] text-white/90 backdrop-blur-2xl">
      <div className="flex h-full items-center gap-5">
        <button type="button" onClick={onAccount} className="flex items-center gap-2 font-semibold transition hover:text-white" title="Account">
          <span className="grid size-5 place-items-center rounded-md bg-white/15 text-[10px] uppercase">{email?.charAt(0) || "A"}</span>
          {email || "Tamu"}
        </button>
        {!isLoggedIn && (
          <span className="hidden items-center gap-2 rounded-full bg-amber-400/20 px-2.5 py-0.5 text-[11px] font-semibold text-amber-100 sm:flex">
            Mode tamu — sebagian aplikasi perlu masuk
            <button
              type="button"
              onClick={onLogin}
              className="rounded-full bg-amber-300/90 px-2 py-0.5 text-[11px] font-bold text-amber-950 transition hover:bg-amber-200"
            >
              Masuk
            </button>
          </span>
        )}
        <nav className="hidden items-center gap-4 text-white/72 md:flex">
          <button onClick={onApplications}>Applications</button>
          {notificationCount > 0 && <button onClick={onNotifications}>Notifications</button>}
          <button onClick={onWidgets}>Widgets</button>
          <button onClick={onSearch}>Search</button>
          {isLoggedIn && <button onClick={onToday}>Hari Ini</button>}
        </nav>
      </div>

      <div className="flex items-center gap-3 text-white/75">
        <button className="hidden items-center gap-1 rounded-full bg-white/10 px-2 py-1 sm:flex" onClick={onSearch}>
          <Command className="size-3" /> K
        </button>
        <button type="button" onClick={onSearch} className="rounded-full p-1 transition hover:bg-white/10" aria-label="Open Spotlight Search" title="Search">
          <Search className="size-4" />
        </button>
        {isLoggedIn && <SystemStatusChip onOpenToday={onToday} />}
        <Wifi className="size-4" />
        <Cloud className="size-4" />
        <span className="hidden sm:inline">{formatClockDate(now)}</span>
        <span>{formatClockTime(now)}</span>
      </div>
    </header>
  );
}
