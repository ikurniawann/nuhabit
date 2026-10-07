"use client";

import { Printer } from "lucide-react";

export function PrintFloatingButton() {
  return (
    <div className="no-print fixed bottom-6 right-6">
      <button
        type="button"
        onClick={() => window.print()}
        className="flex cursor-pointer items-center gap-2 rounded-lg bg-pink-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-pink-200 transition-colors hover:bg-pink-700"
      >
        <Printer className="h-4 w-4" />
        Print / Cetak
      </button>
    </div>
  );
}
