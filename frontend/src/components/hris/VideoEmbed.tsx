"use client";

import { embedUrlFor } from "@/lib/hris/announcement-video";

/**
 * Render iframe video dari provider+id TERSIMPAN (bukan HTML mentah user).
 * embedUrlFor memvalidasi ulang id → null bila data ternodai.
 */
export function VideoEmbed({
  provider,
  videoId,
}: {
  provider: string | null;
  videoId: string | null;
}) {
  if (!provider || !videoId) return null;
  const src = embedUrlFor(provider, videoId);
  if (!src) return null;

  return (
    <div className="relative w-full overflow-hidden rounded-xl bg-black" style={{ aspectRatio: "16 / 9" }}>
      <iframe
        src={src}
        title="Video pengumuman"
        className="absolute inset-0 h-full w-full"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
        loading="lazy"
        referrerPolicy="strict-origin-when-cross-origin"
      />
    </div>
  );
}
