"use client";

import { asset } from "../lib/links";
import type { NewsItem } from "../lib/queries-news";

/** Sampul news; tanpa gambar: permukaan tinta dengan logo NüHabit. */
export function NewsCover({ item, className = "" }: { item: Pick<NewsItem, "image_url">; className?: string }) {
  if (item.image_url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={item.image_url} alt="" className={`object-cover ${className}`} loading="lazy" />;
  }
  return (
    <div className={`nh-surface-ink relative flex items-end overflow-hidden p-3 ${className}`}>
      <div className="pointer-events-none absolute -top-10 -right-8 h-28 w-28 rounded-full bg-nh-lime/20 blur-2xl" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={asset("/brand/mark-white.png")} alt="" className="relative h-6 w-auto opacity-70" />
    </div>
  );
}
