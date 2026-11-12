"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { useT } from "../lib/i18n";

/** Exit length: --motion-base from globals.css, or nothing when motion is reduced. */
function exitMs(): number {
  if (typeof window.matchMedia !== "function" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return 0;
  // The CSS build may rewrite 200ms as .2s.
  const value = getComputedStyle(document.documentElement).getPropertyValue("--motion-base").trim();
  const ms = parseFloat(value) * (value.endsWith("ms") ? 1 : 1000);
  return Number.isFinite(ms) ? ms : 0;
}

/** Lembar bawah: tutup lewat backdrop, tombol ×, atau Escape. */
export function BottomSheet({
  title,
  kicker,
  onClose,
  children,
}: {
  title: string;
  kicker?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const t = useT();
  // Read during render: the close button's autoFocus runs before any effect.
  const [opener] = useState(() => document.activeElement);
  useEffect(() => () => {
    if (opener instanceof HTMLElement) opener.focus();
  }, [opener]);
  // Plays the exit animation (data-closing) before the parent unmounts the sheet.
  const [closing, setClosing] = useState(false);
  const close = useCallback(() => {
    const ms = exitMs();
    if (ms === 0) onClose();
    else setClosing(true);
  }, [onClose]);
  useEffect(() => {
    if (!closing) return;
    const id = window.setTimeout(onClose, exitMs());
    return () => window.clearTimeout(id);
  }, [closing, onClose]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  return (
    <div
      className="nh-sheet-backdrop fixed inset-0 z-40 flex items-end justify-center bg-black/50"
      data-closing={closing || undefined}
      onClick={close}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="nh-sheet-panel max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-nh-cream px-5 pt-3 pb-[max(env(safe-area-inset-bottom),1.5rem)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-nh-line" aria-hidden />
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            {kicker ? (
              <p className="text-[11px] font-extrabold tracking-[0.16em] text-nh-muted uppercase">{kicker}</p>
            ) : null}
            <h2 className="nh-display text-2xl leading-tight">{title}</h2>
          </div>
          <button
            type="button"
            autoFocus
            onClick={close}
            aria-label={t("Close")}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-nh-raised text-nh-ink active:scale-95"
          >
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
