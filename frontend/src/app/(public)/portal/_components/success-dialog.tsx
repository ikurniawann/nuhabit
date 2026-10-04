"use client";

import Link from "next/link";
import { CheckCircle } from "lucide-react";

/** Modal setelah lamaran terkirim; menutup modal kembali ke halaman karir. */
export function SuccessDialog({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-[#131a1c]/60 backdrop-blur-sm transition-opacity" onClick={onClose} />
      <div className="relative z-10 w-full max-w-lg animate-in fade-in zoom-in duration-300">
        <div className="overflow-hidden rounded-2xl bg-white p-8 shadow-2xl">
          <div className="mb-6 flex justify-center">
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-[#f3ece2]">
              <CheckCircle className="h-10 w-10 text-[#00281a]" />
            </div>
          </div>
          <h2 className="mb-3 text-center text-2xl font-semibold leading-tight text-[#131a1c]">Lamaran Terkirim!</h2>
          <p className="mb-8 text-center text-base leading-relaxed text-[#2a332e]">
            Terima kasih sudah melamar. Tim HRD kami akan menghubungi kamu
            melalui WhatsApp atau email dalam 1-3 hari kerja.
          </p>
          <div className="flex flex-col gap-3">
            <Link
              href="/career"
              className="flex w-full items-center justify-center gap-2 rounded-full bg-[#00281a] px-8 py-3 text-sm font-semibold uppercase tracking-[0.08em] text-white transition-all hover:bg-[#203b32] active:scale-95"
            >
              Kembali ke Career Page
            </Link>
            <button
              type="button"
              onClick={onClose}
              className="w-full rounded-full border border-[#e3dbcc] bg-transparent px-8 py-3 text-sm font-semibold uppercase tracking-[0.08em] text-[#131a1c] transition-all hover:bg-[#f3ece2]"
            >
              Tutup
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
