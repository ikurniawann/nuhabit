"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { X } from "lucide-react";
import {
  MENUBAR_H,
  MIN_WINDOW_H,
  MIN_WINDOW_W,
  clampGeometry,
  detectSnapEdge,
  parseGeometryMap,
  rememberGeometry,
  restoreGeometry,
  snapGeometry,
  type GeometryMap,
  type SnapEdge,
  type WindowGeometry,
} from "@/lib/desktop/window-manager";
import { STORAGE_KEYS, readStorage, writeStorage } from "@/lib/storage-keys";
import { useWindowApi, useWindowState } from "../../hooks/use-window-manager";
import { visibleWindowOrder } from "../../lib/window-registry";

const WINDOW_Z_BASE = 40;

function loadGeometryMap(): GeometryMap {
  return parseGeometryMap(readStorage(STORAGE_KEYS.windowGeometry));
}

/** Penyimpanan terkunci (mode privat): jendela tetap jalan tanpa ingatan. */
function persistGeometry(id: string, geo: WindowGeometry) {
  writeStorage(STORAGE_KEYS.windowGeometry, JSON.stringify(rememberGeometry(loadGeometryMap(), id, geo)));
}

function viewport() {
  return { width: window.innerWidth, height: window.innerHeight };
}

/**
 * Bingkai jendela: seret, ubah ukuran, snap ke tepi (Aero Snap / Rectangle),
 * kecilkan ke dock, dan ingatan posisi/ukuran per jendela.
 */
export function WindowShell({
  title,
  children,
  onClose,
  className = "",
  windowId: windowIdProp,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  className?: string;
  /** Id unik bila satu judul bisa terbuka lebih dari satu (deep link / multi-instance). */
  windowId?: string;
}) {
  const windowId = windowIdProp ?? title;
  const windowRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ offsetX: number; offsetY: number } | null>(null);
  const resizeRef = useRef<{ startX: number; startY: number; width: number; height: number } | null>(null);
  const onCloseRef = useRef(onClose);
  const preSnapRect = useRef<WindowGeometry | null>(null);
  const [rect, setRect] = useState<WindowGeometry | null>(() => restoreGeometry(loadGeometryMap(), windowId, viewport()));
  const [snapped, setSnapped] = useState<SnapEdge | null>(null);
  const [snapHint, setSnapHint] = useState<SnapEdge | null>(null);
  const windowApi = useWindowApi();
  const registry = useWindowState();
  const minimized = registry.windows[windowId]?.minimized ?? false;
  // Dibatasi agar tumpukan jendela tidak pernah menyusul dock/menubar (z-75).
  const zIndex = WINDOW_Z_BASE + Math.min(Math.max(0, registry.order.indexOf(windowId)), 29);
  const isActive = !minimized && visibleWindowOrder(registry).at(-1) === windowId;
  const command = registry.command;

  useEffect(() => {
    onCloseRef.current = onClose;
  });

  /* Daftarkan jendela ke manajer (dock + pintasan), lalu lepas saat ditutup. */
  useEffect(() => {
    windowApi?.register(windowId, title, () => onCloseRef.current());
    return () => windowApi?.release(windowId);
  }, [windowApi, windowId, title]);

  const captureRect = useCallback(() => {
    const box = windowRef.current?.getBoundingClientRect();
    if (!box) return null;
    const next = { left: box.left, top: box.top, width: box.width, height: box.height };
    setRect(next);
    return next;
  }, []);

  const applySnap = useCallback(
    (edge: SnapEdge) => {
      const current = rect ?? captureRect();
      if (current && !snapped) preSnapRect.current = current;
      const geo = snapGeometry(edge, viewport());
      setRect(geo);
      setSnapped(edge);
      persistGeometry(windowId, geo);
    },
    [captureRect, rect, snapped, windowId]
  );

  const restoreSnap = useCallback(() => {
    const previous = preSnapRect.current;
    setSnapped(null);
    if (previous) {
      const geo = clampGeometry(previous, viewport());
      setRect(geo);
      persistGeometry(windowId, geo);
    }
  }, [windowId]);

  /* Perintah dari pintasan papan ketik / menu (⌘←, ⌘↑, dst). */
  useEffect(() => {
    if (!command || command.id !== windowId) return;
    const kind = command.kind;
    const frame = requestAnimationFrame(() => {
      if (kind === "restore") restoreSnap();
      else applySnap(kind === "maximize" ? "maximize" : kind === "snap-left" ? "left" : "right");
    });
    return () => cancelAnimationFrame(frame);
  }, [command, windowId, applySnap, restoreSnap]);

  const focusWindow = () => windowApi?.focus(windowId);

  const startDrag = (event: ReactMouseEvent<HTMLDivElement>) => {
    focusWindow();
    const current = rect ?? captureRect();
    if (!current) return;
    dragRef.current = { offsetX: event.clientX - current.left, offsetY: event.clientY - current.top };
    event.preventDefault();
  };

  useEffect(() => {
    const handleMove = (event: MouseEvent) => {
      const drag = dragRef.current;
      const resize = resizeRef.current;
      if (drag) {
        // Seret ke tepi layar = pratinjau snap.
        setSnapHint(detectSnapEdge({ x: event.clientX, y: event.clientY }, viewport()));
        setRect((current) =>
          current && {
            ...current,
            left: Math.max(8, Math.min(window.innerWidth - current.width - 8, event.clientX - drag.offsetX)),
            top: Math.max(MENUBAR_H, Math.min(window.innerHeight - 56, event.clientY - drag.offsetY)),
          }
        );
      }
      if (resize) {
        setRect((current) =>
          current && {
            ...current,
            width: Math.max(MIN_WINDOW_W, Math.min(window.innerWidth - current.left - 8, resize.width + event.clientX - resize.startX)),
            height: Math.max(MIN_WINDOW_H, Math.min(window.innerHeight - current.top - 72, resize.height + event.clientY - resize.startY)),
          }
        );
      }
    };
    const handleUp = (event: MouseEvent) => {
      const wasDragging = Boolean(dragRef.current);
      const wasResizing = Boolean(resizeRef.current);
      dragRef.current = null;
      resizeRef.current = null;
      if (!wasDragging && !wasResizing) return;
      const edge = wasDragging ? detectSnapEdge({ x: event.clientX, y: event.clientY }, viewport()) : null;
      setSnapHint(null);
      if (edge) {
        applySnap(edge);
        return;
      }
      if (wasDragging) setSnapped(null);
      setRect((current) => {
        if (current) persistGeometry(windowId, current);
        return current;
      });
    };

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [applySnap, windowId]);

  const floatingStyle: CSSProperties | undefined = rect
    ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
    : undefined;
  const toggleMaximize = () => (snapped ? restoreSnap() : applySnap("maximize"));

  return (
    <>
      {snapHint ? (
        <div
          aria-hidden
          style={{ ...snapGeometry(snapHint, viewport()), zIndex: WINDOW_Z_BASE - 1 }}
          className="pointer-events-none fixed rounded-3xl border-2 border-pink-200/50 bg-pink-200/10 backdrop-blur-sm transition-all"
        />
      ) : null}
      <div
        ref={windowRef}
        style={{ ...floatingStyle, zIndex, display: minimized ? "none" : undefined }}
        onMouseDown={focusWindow}
        className={`fixed overflow-hidden rounded-3xl border bg-slate-950/55 shadow-2xl backdrop-blur-2xl max-sm:inset-x-2! max-sm:top-11! max-sm:bottom-[72px]! max-sm:h-auto! max-sm:max-h-none! max-sm:w-auto! max-sm:translate-x-0! max-sm:translate-y-0! max-sm:rounded-2xl! ${isActive ? "border-pink-200/35 ring-1 ring-pink-300/20" : "border-white/18"} ${rect ? "" : className}`}
      >
        <div className="flex h-11 cursor-move items-center justify-between border-b border-white/10 px-4" onMouseDown={startDrag} onDoubleClick={toggleMaximize}>
          <div className="flex items-center gap-2" onMouseDown={(event) => event.stopPropagation()}>
            <button className="size-3 rounded-full bg-red-400 transition hover:scale-125" onClick={onClose} aria-label="Close" title="Tutup" />
            <button
              className="size-3 rounded-full bg-amber-300 transition hover:scale-125"
              onClick={() => {
                if (!rect) captureRect();
                windowApi?.setMinimized(windowId, true);
              }}
              aria-label="Minimize"
              title="Kecilkan ke dock"
            />
            <button
              className="size-3 rounded-full bg-emerald-400 transition hover:scale-125"
              onClick={toggleMaximize}
              aria-label="Maximize"
              title={snapped ? "Pulihkan ukuran" : "Layar penuh"}
            />
          </div>
          <span className="select-none text-xs font-medium text-white/65">{title}</span>
          <button onClick={onClose} onMouseDown={(event) => event.stopPropagation()}><X className="size-4 text-white/60" /></button>
        </div>
        <div className="h-[calc(100%-44px)] overflow-auto">{children}</div>
        {!snapped && (
          <button
            aria-label="Resize"
            title="Ubah ukuran"
            className="absolute bottom-2 right-2 size-4 cursor-nwse-resize rounded-sm border-b-2 border-r-2 border-white/35"
            onMouseDown={(event) => {
              event.stopPropagation();
              focusWindow();
              const current = rect ?? captureRect();
              if (!current) return;
              resizeRef.current = { startX: event.clientX, startY: event.clientY, width: current.width, height: current.height };
            }}
          />
        )}
      </div>
    </>
  );
}
