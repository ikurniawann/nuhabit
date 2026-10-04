"use client";

import { Button } from "@/components/ui/button";

/** Tiga ubin ringkas progres hitung opname. */
export function OpnameProgressTiles({
  progress,
}: {
  progress: { total: number; counted: number; variance: number };
}) {
  const tiles = [
    { label: "Total Baris", value: progress.total, tone: "text-gray-900" },
    { label: "Terhitung", value: progress.counted, tone: "text-amber-600" },
    { label: "Ada Selisih", value: progress.variance, tone: "text-pink-600" },
  ];
  return (
    <div className="grid grid-cols-3 gap-3 border-t border-gray-200/70 pt-4">
      {tiles.map((tile) => (
        <div
          key={tile.label}
          className="rounded-lg border border-gray-200/70 bg-gray-50/50 px-3 py-2"
        >
          <p className="text-xs font-medium text-gray-500">{tile.label}</p>
          <p className={`text-lg font-bold ${tile.tone}`}>{tile.value}</p>
        </div>
      ))}
    </div>
  );
}

type OpnameActionProps = {
  busy: boolean;
  disabled: boolean;
  saving: boolean;
  completing: boolean;
  onFillSystem: () => void;
  onCancel?: () => void;
  onSaveDraft: () => void;
  onComplete: () => void;
};

/** Aksi opname di header (desktop). */
export function OpnameDesktopActions({
  busy,
  disabled,
  saving,
  completing,
  onFillSystem,
  onCancel,
  onSaveDraft,
  onComplete,
}: OpnameActionProps) {
  return (
    <div className="hidden flex-wrap gap-2 md:flex">
      <Button
        type="button"
        variant="outline"
        className="purchasing-secondary-button"
        onClick={onFillSystem}
        disabled={busy}
      >
        Isi dengan Stok Sistem
      </Button>
      {onCancel && (
        <Button
          type="button"
          variant="outline"
          className="border-red-200/80 text-red-700"
          onClick={onCancel}
          disabled={busy}
        >
          Batalkan Sesi
        </Button>
      )}
      <Button
        type="button"
        variant="outline"
        className="purchasing-secondary-button"
        onClick={onSaveDraft}
        disabled={busy || disabled}
      >
        {saving && !completing ? "Menyimpan..." : "Simpan Draf"}
      </Button>
      <Button
        type="button"
        className="purchasing-main-button"
        onClick={onComplete}
        disabled={busy || disabled}
      >
        {completing ? "Memproses..." : "Selesaikan Opname"}
      </Button>
    </div>
  );
}

/**
 * Aksi opname di HP: aksi sekunder sebagai tautan, tombol utama di bilah
 * lengket bawah supaya jempol tidak perlu menggulir ke atas.
 */
export function OpnameMobileActions({
  busy,
  disabled,
  saving,
  completing,
  onFillSystem,
  onCancel,
  onSaveDraft,
  onComplete,
}: OpnameActionProps) {
  return (
    <>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs md:hidden">
        <button
          type="button"
          className="text-gray-600 underline-offset-2 hover:underline disabled:opacity-50"
          onClick={onFillSystem}
          disabled={busy}
        >
          Isi semua dengan stok sistem
        </button>
        {onCancel && (
          <button
            type="button"
            className="text-red-600 underline-offset-2 hover:underline disabled:opacity-50"
            onClick={onCancel}
            disabled={busy}
          >
            Batalkan sesi
          </button>
        )}
      </div>
      <div
        className="fixed inset-x-0 bottom-0 z-20 flex gap-2 border-t border-gray-200/70 bg-white/95 p-3 backdrop-blur md:hidden"
        style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
      >
        <Button
          type="button"
          variant="outline"
          className="purchasing-secondary-button h-11 flex-1"
          onClick={onSaveDraft}
          disabled={busy || disabled}
        >
          {saving && !completing ? "Menyimpan..." : "Simpan Draf"}
        </Button>
        <Button
          type="button"
          className="purchasing-main-button h-11 flex-1"
          onClick={onComplete}
          disabled={busy || disabled}
        >
          {completing ? "Memproses..." : "Selesaikan"}
        </Button>
      </div>
    </>
  );
}
