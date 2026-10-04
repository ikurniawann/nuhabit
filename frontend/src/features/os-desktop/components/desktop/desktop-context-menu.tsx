"use client";

import { brandOsName } from "@/lib/branding";

/** Menu klik kanan di wallpaper. */
export function DesktopContextMenu({
  x,
  y,
  onApps,
  onWidgets,
  onSettings,
  onWallpaper,
  onAbout,
}: {
  x: number;
  y: number;
  onApps: () => void;
  onWidgets: () => void;
  onSettings: () => void;
  onWallpaper: () => void;
  onAbout: () => void;
}) {
  const items = [
    { label: "Open Launchpad", run: onApps },
    { label: "Widgets", run: onWidgets },
    { label: "System Settings", run: onSettings },
    { label: "Change Wallpaper", run: onWallpaper },
    { label: `About ${brandOsName()}`, run: onAbout },
  ];
  return (
    <div className="fixed z-[80] w-52 overflow-hidden rounded-2xl border border-white/15 bg-slate-950/80 p-1 text-sm shadow-2xl backdrop-blur-xl" style={{ left: x, top: y }}>
      {items.map((item) => (
        <button key={item.label} onClick={item.run} className="block w-full rounded-xl px-3 py-2 text-left hover:bg-white/10">
          {item.label}
        </button>
      ))}
    </div>
  );
}
