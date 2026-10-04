"use client";

import { ExternalLink, X } from "lucide-react";
import { youtubeEmbedUrl } from "@/lib/member-app/workout";
import { useT } from "../lib/i18n";

/** Bottom sheet playing an exercise how-to video (YouTube embed). */
export function VideoSheet({ title, videoUrl, onClose }: { title: string; videoUrl: string; onClose: () => void }) {
  const t = useT();
  // Tautan pencarian YouTube tidak bisa disematkan: tampilkan tombol buka di YouTube.
  const embedUrl = youtubeEmbedUrl(videoUrl);
  return (
    <div className="nh-sheet-backdrop fixed inset-0 z-40 flex items-end justify-center bg-black/60" onClick={onClose}>
      <div className="nh-sheet-panel w-full max-w-md rounded-t-3xl bg-nh-cream p-5 pb-8" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-nh-muted">{t("How to perform")}</p>
            <h2 className="nh-display truncate text-xl">{title}</h2>
          </div>
          <button
            onClick={onClose}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-nh-raised"
            aria-label={t("Close")}
          >
            <X size={16} />
          </button>
        </div>
        {embedUrl ? (
          <div className="overflow-hidden rounded-2xl bg-nh-ink">
            <iframe
              src={embedUrl}
              title={`${t("How to perform")} ${title}`}
              className="aspect-video w-full"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
        ) : (
          <a
            href={videoUrl}
            target="_blank"
            rel="noreferrer"
            className="nh-btn-ghost flex items-center justify-center gap-2"
          >
            {t("Watch on YouTube")} <ExternalLink size={15} />
          </a>
        )}
        <p className="mt-2.5 text-center text-xs text-nh-muted">
          {t("Video opens from YouTube - technique first, speed second.")}
        </p>
      </div>
    </div>
  );
}
