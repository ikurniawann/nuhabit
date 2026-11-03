"use client";

import { ExternalLink } from "lucide-react";
import { youtubeEmbedUrl } from "@/lib/member-app/workout";
import { useT } from "../lib/i18n";
import { BottomSheet } from "./bottom-sheet";

/** Bottom sheet playing an exercise how-to video (YouTube embed). */
export function VideoSheet({ title, videoUrl, onClose }: { title: string; videoUrl: string; onClose: () => void }) {
  const t = useT();
  // Tautan pencarian YouTube tidak bisa disematkan: tampilkan tombol buka di YouTube.
  const embedUrl = youtubeEmbedUrl(videoUrl);
  return (
    <BottomSheet title={title} kicker={t("How to perform")} onClose={onClose}>
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
    </BottomSheet>
  );
}
