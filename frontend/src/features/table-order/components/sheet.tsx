"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

/**
 * Kunci scroll halaman selama sheet terbuka — teknik `position: fixed` +
 * simpan/pulihkan `scrollY`. Sengaja BUKAN `body.style.overflow = "hidden"`:
 * di Chrome Android / Safari iOS cara itu bisa meninggalkan halaman tidak
 * bisa di-scroll kembali ke atas setelah sheet ditutup (bug QA 2026-09-12).
 * Dipanggil sekali per buka/tutup (tidak bergantung identitas callback).
 */
export function lockPageScroll(): () => void {
  const body = document.body;
  const scrollY = window.scrollY;
  const previous = {
    position: body.style.position,
    top: body.style.top,
    left: body.style.left,
    right: body.style.right,
    width: body.style.width,
    overflow: body.style.overflow,
  };
  body.style.position = "fixed";
  body.style.top = `-${scrollY}px`;
  body.style.left = "0";
  body.style.right = "0";
  body.style.width = "100%";
  body.style.overflow = "hidden";

  return () => {
    body.style.position = previous.position;
    body.style.top = previous.top;
    body.style.left = previous.left;
    body.style.right = previous.right;
    body.style.width = previous.width;
    body.style.overflow = previous.overflow;
    window.scrollTo(0, scrollY);
  };
}

/** Bottom sheet ala aplikasi pesan-antar: overlay gelap + panel dari bawah. */
export function BottomSheet({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  // onClose disimpan di ref supaya efek kunci scroll TIDAK re-run tiap render
  // induk (callback inline berubah identitas) — re-run akan membaca scrollY=0
  // saat body sudah fixed dan memulihkan ke posisi yang salah.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const unlock = lockPageScroll();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      unlock();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" role="dialog" aria-modal="true">
      <button
        type="button"
        aria-label="Tutup"
        onClick={onClose}
        className="absolute inset-0 touch-none bg-black/45 backdrop-blur-[1px]"
      />
      <div className="relative flex max-h-[92dvh] w-full max-w-md flex-col rounded-t-3xl bg-white shadow-2xl">
        <div className="mx-auto mt-2 h-1.5 w-12 rounded-full bg-gray-200" />
        {title !== undefined && (
          <div className="flex items-center justify-between px-5 pb-2 pt-3">
            <div className="text-base font-bold text-gray-900">{title}</div>
            <button
              type="button"
              onClick={onClose}
              className="flex size-8 items-center justify-center rounded-full bg-gray-100 text-gray-600"
              aria-label="Tutup"
            >
              <X className="size-4" />
            </button>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5">{children}</div>
        {footer && (
          <div className="border-t border-gray-100 bg-white px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
