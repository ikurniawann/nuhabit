"use client";

import { Download, ExternalLink } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatBytes, isImageMime } from "@/lib/dataroom/config";
import { ItemIcon } from "@/features/dataroom/components/item-icon";

/**
 * Pratinjau gambar / PDF. `srcBase` = endpoint file (dashboard atau link
 * publik); `?inline=1` / tanpa `download=1` menyajikan inline.
 */
export function PreviewDialog({ open, name, mime, size, inlineUrl, downloadUrl, onClose }: {
  open: boolean; name: string; mime: string | null; size: number;
  inlineUrl: string; downloadUrl: string; onClose: () => void;
}) {
  const isImage = isImageMime(mime);
  const isPdf = mime === "application/pdf";
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
          {isImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={inlineUrl} alt={name} className="mx-auto max-h-[72vh] w-auto max-w-full object-contain" />
          ) : isPdf ? (
            <iframe src={inlineUrl} title={name} className="h-[72vh] w-full bg-white" />
          ) : (
            <div className="flex h-[40vh] flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
              <ItemIcon kind="file" mime={mime} name={name} className="h-14 w-14" />
              Tidak ada pratinjau untuk jenis file ini.
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2">
          {(isImage || isPdf) && (
            <a href={inlineUrl} target="_blank" rel="noreferrer" className={cn(buttonVariants({ variant: "outline" }))}><ExternalLink className="mr-2 h-4 w-4" />Buka di tab baru</a>
          )}
          <a href={downloadUrl} className={cn(buttonVariants())}><Download className="mr-2 h-4 w-4" />Unduh</a>
        </div>
      </DialogContent>
    </Dialog>
  );
}
