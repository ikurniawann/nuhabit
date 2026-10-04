"use client";

import Image from "next/image";
import { MegaphoneIcon } from "@heroicons/react/24/outline";
import { CheckCircleIcon } from "@heroicons/react/24/solid";
import { formatDateLong } from "@/lib/format";
import type { EssAnnouncementItem } from "../types";

export function announcementCoverSrc(path: string | null): string | null {
  return path ? `/api/hris/announcements/cover/${path}` : null;
}

/** Tanggal terbit (atau tanggal dibuat), "Sabtu, 4 Oktober 2026". */
export function announcementDate(item: Pick<EssAnnouncementItem, "publish_at" | "created_at">) {
  return formatDateLong(item.publish_at ?? item.created_at, "");
}

export function AnnouncementCard({ item, onOpen }: { item: EssAnnouncementItem; onOpen: () => void }) {
  const cover = announcementCoverSrc(item.cover_image_url);
  const read = item.is_read;
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`group flex flex-col overflow-hidden rounded-xl border text-left shadow-sm transition hover:shadow ${
        read
          ? "border-gray-200/70 bg-gray-50/50 hover:border-gray-300"
          : "border-pink-200 bg-white ring-1 ring-pink-100 hover:border-pink-300"
      }`}
    >
      <div className="relative aspect-video w-full overflow-hidden bg-gradient-to-br from-pink-50 to-indigo-50">
        {cover ? (
          <Image
            src={cover}
            alt=""
            fill
            unoptimized
            className={`object-cover transition ${
              read ? "opacity-70 grayscale-[30%] group-hover:opacity-90" : ""
            }`}
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <MegaphoneIcon className={`h-10 w-10 ${read ? "text-gray-200" : "text-pink-200"}`} />
          </div>
        )}
        <div className="absolute left-2 top-2 flex gap-1.5">
          {item.is_pinned && (
            <span className="rounded-full bg-amber-500/90 px-2 py-0.5 text-[10px] font-bold text-white">
              📌 Disematkan
            </span>
          )}
          {read ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-gray-900/60 px-2 py-0.5 text-[10px] font-semibold text-white backdrop-blur-sm">
              <CheckCircleIcon className="h-3 w-3" /> Dibaca
            </span>
          ) : (
            <span className="rounded-full bg-pink-600 px-2 py-0.5 text-[10px] font-bold text-white">
              Baru
            </span>
          )}
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <p className={`line-clamp-2 ${read ? "font-medium text-gray-500" : "font-semibold text-gray-900"}`}>
          {item.title}
        </p>
        {item.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {item.tags.slice(0, 3).map((tag) => (
              <span
                key={tag}
                className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
        <p className="mt-auto text-xs text-gray-400">{announcementDate(item)}</p>
      </div>
    </button>
  );
}
