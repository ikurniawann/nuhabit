"use client";

import { useEffect, useState } from "react";
import { Download, ExternalLink, Loader2 } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatBytes } from "@/lib/dataroom/config";
import { previewKind } from "@/lib/dataroom/drive";
import { ItemIcon } from "@/features/dataroom/components/item-icon";

/**
 * Pratinjau: gambar, PDF, video/audio (streaming Range), teks/markdown/CSV/
 * JSON, dan dokumen Office lewat teks hasil ekstraksi (`textUrl`), karena
 * kontainer tidak memuat LibreOffice untuk konversi ke PDF.
 */
export function PreviewDialog({ open, name, mime, size, inlineUrl, downloadUrl, textUrl, canDownload = true, onClose }: {
  open: boolean; name: string; mime: string | null; size: number;
  inlineUrl: string; downloadUrl: string; textUrl?: string; canDownload?: boolean; onClose: () => void;
}) {
  const kind = previewKind(mime);
  const openInTab = kind === "image" || kind === "pdf";
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="flex max-h-[92vh] flex-col gap-3 p-4 sm:max-w-5xl">
        <DialogHeader className="pr-8">
          <DialogTitle className="flex items-center gap-2 text-base">
            <ItemIcon kind="file" mime={mime} name={name} className="h-5 w-5" />
            <span className="truncate">{name}</span>
            <span className="text-xs font-normal text-muted-foreground">{formatBytes(size)}</span>
          </DialogTitle>
        </DialogHeader>
        <div className="min-h-[50vh] flex-1 overflow-hidden rounded-lg bg-muted/40">
          {kind === "image" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={inlineUrl} alt={name} className="mx-auto max-h-[72vh] w-auto max-w-full object-contain" />
          ) : kind === "pdf" ? (
            <iframe src={inlineUrl} title={name} className="h-[72vh] w-full bg-white" />
          ) : kind === "video" ? (
            <video src={inlineUrl} controls className="mx-auto max-h-[72vh] w-full bg-black" aria-label={name} />
          ) : kind === "audio" ? (
            <div className="flex h-[40vh] items-center justify-center p-6">
              <audio src={inlineUrl} controls className="w-full max-w-xl" aria-label={name} />
            </div>
          ) : kind === "text" ? (
            <TextPane url={inlineUrl} raw />
          ) : kind === "office" && textUrl ? (
            <TextPane url={textUrl} note="Pratinjau berupa teks hasil ekstraksi; konversi ke PDF tidak tersedia di server (LibreOffice tidak terpasang). Unduh untuk tampilan asli." />
          ) : (
            <div className="flex h-[40vh] flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
              <ItemIcon kind="file" mime={mime} name={name} className="h-14 w-14" />
              Tidak ada pratinjau untuk jenis file ini.
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2">
          {openInTab && (
            <a href={inlineUrl} target="_blank" rel="noreferrer" className={cn(buttonVariants({ variant: "outline" }))}><ExternalLink className="mr-2 h-4 w-4" />Buka di tab baru</a>
          )}
          {canDownload && <a href={downloadUrl} className={cn(buttonVariants())}><Download className="mr-2 h-4 w-4" />Unduh</a>}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Teks dari `url`: badan mentah (`raw`) atau `{ data: { text, truncated } }`. */
function TextPane({ url, raw = false, note }: { url: string; raw?: boolean; note?: string }) {
  type Loaded = { text: string; truncated: boolean } | { error: string };
  // Hasil disimpan bersama url-nya; url lain berarti masih memuat.
  const [loaded, setLoaded] = useState<{ url: string; result: Loaded } | null>(null);
  const state = loaded?.url === url ? loaded.result : null;
  useEffect(() => {
    let cancelled = false;
    const setState = (result: Loaded) => setLoaded({ url, result });
    fetch(url)
      .then(async (res) => {
        if (raw) {
          if (!res.ok) throw new Error(`Gagal memuat (${res.status})`);
          return { text: await res.text(), truncated: false };
        }
        const json = (await res.json()) as { data?: { text: string; truncated: boolean }; error?: string };
        if (!res.ok || !json.data) throw new Error(json.error || `Gagal memuat (${res.status})`);
        return json.data;
      })
      .then((data) => { if (!cancelled) setState(data); })
      .catch((err: unknown) => { if (!cancelled) setState({ error: err instanceof Error ? err.message : "Gagal memuat" }); });
    return () => { cancelled = true; };
  }, [url, raw]);

  if (state === null) {
    return <div className="flex h-[40vh] items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Memuat…</div>;
  }
  if ("error" in state) {
    return <div className="flex h-[40vh] items-center justify-center px-6 text-center text-sm text-muted-foreground">{state.error}</div>;
  }
  return (
    <div className="flex h-[72vh] flex-col">
      {note && <p className="border-b bg-amber-50 px-3 py-2 text-xs text-amber-800">{note}</p>}
      <pre className="flex-1 overflow-auto whitespace-pre-wrap break-words p-4 font-mono text-xs leading-relaxed">{state.text}</pre>
      {state.truncated && <p className="border-t px-3 py-1.5 text-xs text-muted-foreground">Teks dipotong; unduh file untuk isi lengkap.</p>}
    </div>
  );
}
