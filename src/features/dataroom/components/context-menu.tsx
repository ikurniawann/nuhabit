"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Menu klik kanan ala Google Drive: dipasang di posisi kursor, digeser agar
 * tidak keluar layar, tutup saat klik di luar / Escape / scroll.
 */
export interface MenuEntry {
  key: string;
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  separatorBefore?: boolean;
  onSelect: () => void;
}

export function ContextMenu({ x, y, entries, onClose }: { x: number; y: number; entries: MenuEntry[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { innerWidth, innerHeight } = window;
    const rect = el.getBoundingClientRect();
    setPos({
      left: Math.max(4, Math.min(x, innerWidth - rect.width - 8)),
      top: Math.max(4, Math.min(y, innerHeight - rect.height - 8)),
    });
  }, [x, y]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onClose, true);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onClose, true);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="menu"
      style={{ left: pos.left, top: pos.top }}
      className="fixed z-[70] min-w-[210px] rounded-lg border bg-popover p-1 text-sm text-popover-foreground shadow-xl animate-in fade-in-0 zoom-in-95"
      onContextMenu={(e) => e.preventDefault()}
    >
      {entries.map((entry) => (
        <div key={entry.key}>
          {entry.separatorBefore && <div className="my-1 h-px bg-border" />}
          <button
            type="button"
            role="menuitem"
            disabled={entry.disabled}
            onClick={() => { onClose(); entry.onSelect(); }}
            className={cn(
              "flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left outline-none",
              "hover:bg-muted focus:bg-muted disabled:opacity-40 disabled:hover:bg-transparent",
              entry.danger && "text-destructive hover:bg-destructive/10 focus:bg-destructive/10"
            )}
          >
            <span className="flex h-4 w-4 items-center justify-center [&>svg]:h-4 [&>svg]:w-4">{entry.icon}</span>
            {entry.label}
          </button>
        </div>
      ))}
    </div>
  );
}
