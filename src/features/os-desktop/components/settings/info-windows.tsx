"use client";

import { MonitorDot } from "lucide-react";
import { brandName } from "@/lib/branding";
import { SHORTCUT_HINTS } from "@/lib/desktop/window-manager";
import { WindowShell } from "../windows/window-shell";

export function ShortcutCheatSheet({ onClose }: { onClose: () => void }) {
  return (
    <WindowShell title="Pintasan Papan Ketik" onClose={onClose} className="left-1/2 top-24 w-[min(460px,calc(100vw-32px))] -translate-x-1/2">
      <div className="p-5">
        <p className="mb-3 text-xs text-white/50">
          Kombinasi sengaja menghindari pintasan yang dipakai browser (⌘W menutup tab, ⌘Tab pindah aplikasi).
        </p>
        <div className="space-y-1.5">
          {SHORTCUT_HINTS.map((hint) => (
            <div key={hint.combo} className="flex items-center justify-between rounded-xl bg-white/6 px-3 py-2 text-sm">
              <span className="text-white/75">{hint.label}</span>
              <kbd className="rounded-md border border-white/15 bg-white/10 px-2 py-0.5 font-mono text-xs">{hint.combo}</kbd>
            </div>
          ))}
        </div>
      </div>
    </WindowShell>
  );
}

export function AboutWindow({ onClose }: { onClose: () => void }) {
  const brand = brandName();
  return (
    <WindowShell title={`About ${brand}`} onClose={onClose} className="left-1/2 top-24 w-[min(420px,calc(100vw-32px))] -translate-x-1/2">
      <div className="p-6 text-center">
        <div className="mx-auto mb-4 grid size-16 place-items-center rounded-3xl bg-accent text-accent-foreground"><MonitorDot className="size-8" /></div>
        <h2 className="text-xl font-semibold">{brand}</h2>
        <p className="mt-2 text-sm leading-6 text-white/60">Desktop portal untuk HRIS, Procurement, POS, CRM, dan Do.</p>
        <div className="mt-5 rounded-2xl bg-white/8 p-3 text-xs text-white/50">Version 1.0 · macOS-inspired shell</div>
      </div>
    </WindowShell>
  );
}
