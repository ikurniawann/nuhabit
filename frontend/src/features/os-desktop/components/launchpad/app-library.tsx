"use client";

import { DESKTOP_MODULES, type DesktopModule } from "../../lib/modules";
import { WindowShell } from "../windows/window-shell";

/** Launchpad: semua modul dashboard dalam satu jendela. */
export function AppLibrary({ onClose, onOpen }: { onClose: () => void; onOpen: (module: DesktopModule) => void }) {
  return (
    <WindowShell title="Applications" onClose={onClose} className="left-1/2 top-20 w-[min(620px,calc(100vw-32px))] -translate-x-1/2">
      <div className="grid grid-cols-2 gap-3 p-5 sm:grid-cols-4">
        {DESKTOP_MODULES.map((module) => {
          const Icon = module.icon;
          return (
            <button key={module.name} onClick={() => onOpen(module)} className="rounded-3xl bg-white/8 p-4 text-center transition hover:bg-white/14">
              <div className="mx-auto mb-3 grid size-14 place-items-center rounded-2xl bg-accent text-accent-foreground">
                <Icon className="size-7" />
              </div>
              <div className="text-sm font-medium">{module.name}</div>
              <div className="text-[11px] text-white/45">{module.subtitle}</div>
            </button>
          );
        })}
      </div>
    </WindowShell>
  );
}
