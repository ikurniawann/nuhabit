"use client";

import Image from "next/image";
import type { ComponentType } from "react";

export type DockAppItem = {
  label: string;
  icon: ComponentType<{ className?: string }>;
  active: boolean;
  /** Jendelanya terbuka tapi tidak sedang aktif → titik di bawah ikon. */
  running?: boolean;
  onClick: () => void;
};

export type DockWindowChip = { id: string; title: string; minimized: boolean };

/** Label di atas ikon saat hover/fokus (sm+; di ponsel dock bisa digulir dan memotongnya). */
function DockTooltip({ label }: { label: string }) {
  return (
    <span className="pointer-events-none absolute -top-10 left-1/2 hidden -translate-x-1/2 translate-y-1 rounded-lg bg-ink px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap text-white opacity-0 shadow-lg ring-1 ring-white/10 transition duration-150 group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:translate-y-0 group-focus-visible:opacity-100 sm:block">
      {label}
    </span>
  );
}

function DockButton({ label, icon: Icon, onClick, active, running = false }: DockAppItem) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={`group relative grid size-10 shrink-0 place-items-center rounded-xl transition duration-200 hover:-translate-y-1 focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none sm:size-12 sm:rounded-2xl ${
        active
          ? "bg-accent text-accent-foreground shadow-[0_8px_24px_rgba(218,255,89,.28)]"
          : "border border-white/8 bg-white/[0.06] text-white/80 hover:bg-white/12 hover:text-white"
      }`}
    >
      <Icon className="size-4 transition group-hover:scale-110 sm:size-5" />
      <DockTooltip label={label} />
      {running && !active && <span className="absolute -bottom-1 size-1 rounded-full bg-white/60" />}
    </button>
  );
}

function DockDivider() {
  return <div className="mx-0.5 h-6 w-px shrink-0 bg-white/12 sm:mx-1 sm:h-8" />;
}

/**
 * Dock: tombol merek (Launchpad), Do, lalu aplikasi sistem, lalu chip jendela
 * terbuka. Pintasan per-modul sengaja TIDAK ada: daftar lengkapnya sudah di
 * Launchpad, dan 14 ikon membuat dock penuh.
 */
export function Dock({
  launchpadOpen,
  onToggleLaunchpad,
  assistant,
  apps,
  windows,
  activeWindowId,
  onFocusWindow,
}: {
  launchpadOpen: boolean;
  onToggleLaunchpad: () => void;
  assistant: DockAppItem;
  apps: DockAppItem[];
  windows: DockWindowChip[];
  activeWindowId: string | null;
  onFocusWindow: (id: string) => void;
}) {
  return (
    <nav
      aria-label="Dock"
      className="fixed bottom-3 left-1/2 z-[75] flex max-w-[calc(100vw-12px)] -translate-x-1/2 items-center gap-1 overflow-x-auto rounded-[22px] border border-white/10 bg-ink/75 p-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,.08),0_24px_60px_rgba(0,0,0,.5)] backdrop-blur-2xl sm:bottom-5 sm:gap-1.5 sm:overflow-visible sm:rounded-[26px] sm:p-2"
    >
      <button
        type="button"
        aria-label="Applications"
        title="Applications"
        aria-pressed={launchpadOpen}
        onClick={onToggleLaunchpad}
        className={`group relative grid size-10 shrink-0 place-items-center rounded-xl bg-forest shadow-lg ring-1 transition duration-200 hover:-translate-y-1 sm:size-12 sm:rounded-2xl ${launchpadOpen ? "ring-accent" : "ring-white/10 hover:ring-accent/60"}`}
      >
        <Image src="/brand/mark-lime.png" alt="" width={28} height={28} className="w-6 transition group-hover:scale-110 sm:w-7" />
        <DockTooltip label="Applications" />
      </button>
      <DockButton {...assistant} />
      <DockDivider />
      {apps.map((app) => (
        <DockButton key={app.label} {...app} />
      ))}
      {windows.length > 0 && (
        <>
          <DockDivider />
          {/* Jendela terbuka: yang dikecilkan diredupkan, yang aktif diberi cincin. */}
          {windows.map((win) => {
            const isActive = activeWindowId === win.id;
            const label = win.minimized ? `Tampilkan ${win.title}` : `Ke ${win.title}`;
            return (
              <button
                key={win.id}
                type="button"
                title={label}
                aria-label={label}
                onClick={() => onFocusWindow(win.id)}
                className={`group relative grid h-10 shrink-0 place-items-center rounded-xl border px-2.5 text-[11px] font-semibold transition duration-200 hover:-translate-y-1 hover:bg-white/12 sm:h-12 sm:rounded-2xl sm:px-3 ${
                  isActive
                    ? "border-accent/45 bg-white/10 text-white"
                    : win.minimized
                      ? "border-white/6 bg-white/[0.03] text-white/50"
                      : "border-white/8 bg-white/[0.06] text-white/85"
                }`}
              >
                <span className="max-w-[92px] truncate">{win.title}</span>
                {!win.minimized && (
                  <span className={`absolute -bottom-1 h-1 rounded-full transition-all ${isActive ? "w-3 bg-accent" : "w-1 bg-white/55"}`} />
                )}
              </button>
            );
          })}
        </>
      )}
    </nav>
  );
}
