"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
import { memberFetch } from "../lib";
import { CenterSpinner, Eyebrow, SectionTitle, Sheet, Tag, TextAction } from "../ui";

export interface NewsItem {
  id: string;
  title: string;
  category: "news" | "event" | "tips" | "promo";
  summary: string | null;
  body?: string | null;
  image_url: string | null;
  published_at: string;
}

export const NEWS_CATEGORY: Record<NewsItem["category"], string> = { news: "News", event: "Events", tips: "Training", promo: "Promo" };

export function published(at: string): string {
  return new Date(at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Jakarta" });
}

export function useNews() {
  const [items, setItems] = useState<NewsItem[] | null>(null);
  useEffect(() => {
    memberFetch<{ data: NewsItem[] }>("/api/member-portal/studio/news")
      .then((r) => setItems(r.data))
      .catch(() => setItems([]));
  }, []);
  return items;
}

export function NewsImage({ item, className = "" }: { item: NewsItem; className?: string }) {
  return item.image_url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={item.image_url} alt="" className={`object-cover ${className}`} />
  ) : (
    <div className={`flex items-end bg-nh-everglade p-3 ${className}`}>
      <span className="font-display text-3xl font-bold uppercase leading-none text-nh-lime/30">NÜ</span>
    </div>
  );
}

/** Detail artikel di panel samping (memuat isi lengkap). */
export function NewsSheet({ item, onClose }: { item: NewsItem | null; onClose: () => void }) {
  const [full, setFull] = useState<NewsItem | null>(null);
  useEffect(() => {
    if (!item) return;
    let alive = true;
    memberFetch<{ data: NewsItem }>(`/api/member-portal/studio/news/${item.id}`)
      .then((r) => alive && setFull(r.data))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [item]);
  const n = full && item && full.id === item.id ? full : item;
  return (
    <Sheet open={!!item} onClose={() => { setFull(null); onClose(); }} title={n?.title ?? ""}>
      {n && (
        <article className="space-y-5">
          <NewsImage item={n} className="aspect-[16/10] w-full" />
          <div className="flex items-center gap-3">
            <Tag>{NEWS_CATEGORY[n.category]}</Tag>
            <Eyebrow>{published(n.published_at)}</Eyebrow>
          </div>
          {n.summary && <p className="text-base font-semibold uppercase leading-snug tracking-wide text-white">{n.summary}</p>}
          {n.body && <p className="whitespace-pre-line text-sm leading-relaxed text-nh-beige/80">{n.body}</p>}
        </article>
      )}
    </Sheet>
  );
}

/** News di beranda: carousel foto besar + indikator progres (pola carousel referensi). */
export function NewsSection({ onSeeAll }: { onSeeAll?: () => void }) {
  const items = useNews();
  const [open, setOpen] = useState<NewsItem | null>(null);
  const [progress, setProgress] = useState(0);
  const track = useRef<HTMLDivElement>(null);

  if (!items) return <CenterSpinner />;
  if (items.length === 0) return null;

  return (
    <section>
      <SectionTitle action={onSeeAll && <TextAction onClick={onSeeAll}>All news</TextAction>}>Hyrox news</SectionTitle>
      <div
        ref={track}
        onScroll={(e) => {
          const el = e.currentTarget;
          setProgress(el.scrollWidth > el.clientWidth ? el.scrollLeft / (el.scrollWidth - el.clientWidth) : 0);
        }}
        className="-mx-5 flex snap-x snap-mandatory gap-3 overflow-x-auto px-5 [scrollbar-width:none]"
      >
        {items.map((n) => (
          <button key={n.id} type="button" onClick={() => setOpen(n)} className="group relative aspect-[4/5] w-[78%] shrink-0 snap-start overflow-hidden bg-nh-jungle text-left">
            <NewsImage item={n} className="absolute inset-0 size-full transition group-hover:scale-105" />
            <span className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent" />
            <span className="absolute inset-x-0 bottom-0 p-4">
              <Tag tone={n.category === "promo" ? "lime" : "light"}>{NEWS_CATEGORY[n.category]}</Tag>
              <span className="mt-3 block font-display text-2xl font-bold uppercase leading-[0.95] tracking-tight text-white">{n.title}</span>
              {n.summary && <span className="mt-2 line-clamp-2 block text-xs uppercase tracking-wide text-nh-beige/75">{n.summary}</span>}
              <span className="mt-3 inline-flex size-8 items-center justify-center rounded-full bg-nh-beige text-black">
                <ChevronRight className="size-4" />
              </span>
            </span>
          </button>
        ))}
      </div>
      {items.length > 1 && (
        <div className="mt-4 h-0.5 w-full bg-white/15">
          <div className="h-full bg-white transition-all" style={{ width: `${Math.max(100 / items.length, progress * 100)}%` }} />
        </div>
      )}
      <NewsSheet item={open} onClose={() => setOpen(null)} />
    </section>
  );
}
