"use client";

import { useEffect, useState } from "react";
import { memberFetch } from "../lib";
import { CenterSpinner, SectionTitle, Sheet, Tag } from "../ui";

interface NewsItem {
  id: string;
  title: string;
  category: "news" | "event" | "tips" | "promo";
  summary: string | null;
  body?: string | null;
  image_url: string | null;
  published_at: string;
}

const CATEGORY: Record<NewsItem["category"], string> = { news: "News", event: "Event", tips: "Training tips", promo: "Promo" };

function published(at: string): string {
  return new Date(at).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Asia/Jakarta" });
}

/** News Hyrox di beranda: kartu geser horizontal + detail di lembar bawah. */
export function NewsSection() {
  const [items, setItems] = useState<NewsItem[] | null>(null);
  const [open, setOpen] = useState<NewsItem | null>(null);

  useEffect(() => {
    memberFetch<{ data: NewsItem[] }>("/api/member-portal/studio/news")
      .then((r) => setItems(r.data))
      .catch(() => setItems([]));
  }, []);

  async function show(n: NewsItem) {
    setOpen(n);
    try {
      setOpen((await memberFetch<{ data: NewsItem }>(`/api/member-portal/studio/news/${n.id}`)).data);
    } catch {
      /* tampilkan ringkasan saja */
    }
  }

  if (!items) return <CenterSpinner />;
  if (items.length === 0) return null;

  return (
    <section>
      <SectionTitle>Hyrox News</SectionTitle>
      <div className="-mx-5 flex snap-x gap-3 overflow-x-auto px-5 pb-1">
        {items.map((n) => (
          <button key={n.id} type="button" onClick={() => show(n)} className="w-64 shrink-0 snap-start overflow-hidden rounded-3xl border border-white/10 bg-nh-jungle text-left">
            {n.image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={n.image_url} alt="" className="aspect-[16/9] w-full object-cover" />
            ) : (
              <div className="aspect-[16/9] w-full bg-gradient-to-br from-nh-forest to-nh-everglade" />
            )}
            <div className="space-y-1.5 p-4">
              <div className="flex items-center gap-2">
                <Tag tone={n.category === "promo" ? "lime" : "muted"}>{CATEGORY[n.category]}</Tag>
                <span className="text-[11px] text-nh-beige/50">{published(n.published_at)}</span>
              </div>
              <p className="line-clamp-2 font-semibold">{n.title}</p>
              {n.summary && <p className="line-clamp-2 text-xs text-nh-beige/60">{n.summary}</p>}
            </div>
          </button>
        ))}
      </div>

      <Sheet open={!!open} onClose={() => setOpen(null)} title={open?.title ?? ""}>
        {open && (
          <article className="space-y-4">
            {open.image_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={open.image_url} alt="" className="aspect-[16/9] w-full rounded-2xl object-cover" />
            )}
            <div className="flex items-center gap-2">
              <Tag>{CATEGORY[open.category]}</Tag>
              <span className="text-xs text-nh-beige/50">{published(open.published_at)}</span>
            </div>
            {open.summary && <p className="font-medium text-nh-beige/90">{open.summary}</p>}
            {open.body && <p className="whitespace-pre-line text-sm leading-relaxed text-nh-beige/80">{open.body}</p>}
          </article>
        )}
      </Sheet>
    </section>
  );
}
