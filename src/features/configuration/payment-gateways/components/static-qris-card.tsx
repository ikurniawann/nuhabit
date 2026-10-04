"use client";

/* eslint-disable @next/next/no-img-element */

import { useRef } from "react";
import { ImageUp, Loader2, QrCode, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useStaticQrisMutation } from "../mutations";
import { useStaticQris } from "../queries";

/**
 * Static QRIS: gambar QRIS statis venue yang ditampilkan ke pemesan
 * self-order (QR meja). Pemesan membayar lalu mengunggah bukti; kasir
 * memverifikasi bukti di Open Bills sebelum melunasi.
 */
export function StaticQrisCard() {
  const query = useStaticQris();
  const mutation = useStaticQrisMutation();
  const fileRef = useRef<HTMLInputElement>(null);
  const config = query.data;
  const busy = mutation.isPending;

  function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) mutation.mutate({ type: "upload", file });
  }

  return (
    <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="rounded-md bg-primary/10 p-2 text-brand-text">
            <QrCode className="size-4" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-foreground">
              Static QRIS
            </h2>
            <p className="text-sm text-muted-foreground">
              Metode bayar self-order (QR meja): pemesan scan gambar QRIS ini,
              lalu mengunggah bukti bayar. Kasir memeriksa bukti di Open Bills
              sebelum melunasi pesanan.
            </p>
          </div>
        </div>
        {config?.imageUrl ? (
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              mutation.mutate({ type: "toggle", enabled: !config.enabled })
            }
            className={cn(
              "flex shrink-0 items-center gap-3 rounded-lg border px-3 py-2 text-sm",
              config.enabled
                ? "border-primary/30 bg-primary/5 text-foreground"
                : "border-border bg-muted/30 text-muted-foreground",
            )}
          >
            <span className="font-medium">
              {config.enabled ? "Aktif" : "Nonaktif"}
            </span>
            <span
              className={cn(
                "relative h-5 w-9 rounded-full transition-colors",
                config.enabled ? "bg-primary" : "bg-muted-foreground/30",
              )}
            >
              <span
                className={cn(
                  "absolute top-0.5 size-4 rounded-full bg-white shadow transition-transform",
                  config.enabled ? "left-4" : "left-0.5",
                )}
              />
            </span>
          </button>
        ) : null}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={handleFile}
      />

      {query.isLoading ? (
        <div className="flex items-center justify-center py-10 text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
        </div>
      ) : query.isError ? (
        <div className="mt-4 rounded-lg border border-red-200/80 bg-red-50 px-4 py-3 text-sm text-red-700">
          {query.error instanceof Error
            ? query.error.message
            : "Gagal memuat Static QRIS"}
        </div>
      ) : config?.imageUrl ? (
        <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-start">
          <img
            src={config.imageUrl}
            alt="Gambar Static QRIS"
            className="w-full max-w-[220px] rounded-lg border border-border bg-white object-contain"
          />
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
              className="gap-2"
            >
              {busy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <ImageUp className="size-4" />
              )}
              Ganti gambar
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => {
                if (
                  window.confirm(
                    "Hapus gambar Static QRIS? Opsi ini akan hilang dari self-order.",
                  )
                ) {
                  mutation.mutate({ type: "remove" });
                }
              }}
              className="gap-2 text-red-600 hover:text-red-700"
            >
              <Trash2 className="size-4" /> Hapus
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
          className="mt-4 flex w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border px-4 py-8 text-sm text-muted-foreground hover:bg-muted/30"
        >
          {busy ? (
            <Loader2 className="size-5 animate-spin" />
          ) : (
            <ImageUp className="size-5" />
          )}
          <span className="font-medium text-foreground">
            Unggah gambar QRIS
          </span>
          <span>
            JPG/PNG/WebP, maks. 5 MB — langsung aktif setelah diunggah
          </span>
        </button>
      )}
    </section>
  );
}
