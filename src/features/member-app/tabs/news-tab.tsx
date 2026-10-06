"use client";

import { useState } from "react";
import { CenterSpinner, Empty, Eyebrow, PageTitle } from "../ui";
import { NEWS_CATEGORY, NewsImage, type NewsItem, NewsSheet, published, useNews } from "./news-section";

type Filter = "all" | NewsItem["category"];
const FILTERS: Filter[] = ["all", "news", "event", "tips", "promo"];

/** Halaman News: filter kategori (All / News / Events / Training / Promo) + daftar editorial. */
export function NewsTab() {
  const items = useNews();
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<NewsItem | null>(null);
  const list = (items ?? []).filter((n) => filter === "all" || n.category === filter);

  return (
    <div className="space-y-6">
      <PageTitle sub="Events, training notes and what's new at NüHabit.">News</PageTitle>
      <div className="-mx-5 flex gap-2 overflow-x-auto px-5 [scrollbar-width:none]">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`shrink-0 rounded-full border px-4 py-1.5 text-[11px] font-bold uppercase tracking-[0.1em] transition ${filter === f ? "border-nh-beige bg-nh-beige text-black" : "border-white/30 text-nh-beige/80 hover:border-white/60"}`}
          >
            {f === "all" ? "All" : NEWS_CATEGORY[f]}
          </button>
        ))}
      </div>
      {!items ? (
        <CenterSpinner />
      ) : list.length === 0 ? (
        <Empty title="Nothing here yet." hint="Check back soon." />
      ) : (
        <div className="border-t border-white/15">
          {list.map((n) => (
            <button key={n.id} type="button" onClick={() => setOpen(n)} className="group flex w-full gap-4 border-b border-white/15 py-4 text-left">
              <NewsImage item={n} className="aspect-square w-24 shrink-0 grayscale transition group-hover:grayscale-0" />
              <span className="min-w-0 flex-1">
                <Eyebrow>
                  {NEWS_CATEGORY[n.category]} · {published(n.published_at)}
                </Eyebrow>
                <span className="mt-1.5 line-clamp-2 block font-display text-xl font-bold uppercase leading-[1] tracking-tight text-white group-hover:text-nh-lime">{n.title}</span>
                {n.summary && <span className="mt-1.5 line-clamp-2 block text-xs text-nh-beige/65">{n.summary}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
      <NewsSheet item={open} onClose={() => setOpen(null)} />
    </div>
  );
}
