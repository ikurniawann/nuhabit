"use client";

import { useState } from "react";
import { MegaphoneIcon } from "@heroicons/react/24/outline";
import { ArrowDownWideNarrow, ArrowUpWideNarrow, Loader2 } from "lucide-react";
import {
  visibleAnnouncements,
  type AnnouncementReadFilter,
  type AnnouncementSort,
} from "@/lib/hris/ess-view";
import { useAnnouncementFeed } from "../queries";
import { useMarkAnnouncementRead } from "../mutations";
import type { EssAnnouncementItem } from "../types";
import { AnnouncementCard } from "./announcement-card";
import { AnnouncementDetailDialog } from "./announcement-detail-dialog";

/**
 * ESS → Pengumuman Perusahaan (/dashboard/me/pengumuman): feed pengumuman
 * yang menyasar karyawan (global/departemennya), buka detail = tandai baca.
 */
export function EssPengumumanPage() {
  const { data, isLoading } = useAnnouncementFeed();
  const items = data ?? [];
  const markRead = useMarkAnnouncementRead();
  const [openId, setOpenId] = useState<string | null>(null);
  const [readFilter, setReadFilter] = useState<AnnouncementReadFilter>("all");
  const [sortOrder, setSortOrder] = useState<AnnouncementSort>("newest");

  const unreadCount = items.filter((it) => !it.is_read).length;
  const visibleItems = visibleAnnouncements(items, readFilter, sortOrder);

  function openDetail(item: EssAnnouncementItem) {
    setOpenId(item.id);
    if (!item.is_read) markRead.mutate(item.id);
  }

  if (isLoading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="border-b border-gray-200/70 pb-4">
        <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900">
          <MegaphoneIcon className="h-6 w-6 text-pink-600" /> Pengumuman Perusahaan
        </h1>
        <p className="text-sm text-gray-500">Informasi & pengumuman terbaru dari perusahaan</p>
      </div>

      {items.length === 0 ? (
        <div className="rounded-xl border border-gray-200/70 bg-white p-10 text-center shadow-sm">
          <MegaphoneIcon className="mx-auto h-10 w-10 text-gray-300" />
          <p className="mt-3 text-sm text-gray-500">Belum ada pengumuman.</p>
        </div>
      ) : (
        <>
          {/* Filter dibaca/belum + urutan tanggal */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="inline-flex rounded-lg border border-gray-200/70 bg-white p-0.5 shadow-sm">
              {(
                [
                  { key: "all", label: "Semua", count: items.length },
                  { key: "unread", label: "Belum dibaca", count: unreadCount },
                  { key: "read", label: "Sudah dibaca", count: items.length - unreadCount },
                ] as const
              ).map((tab) => {
                const active = readFilter === tab.key;
                return (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setReadFilter(tab.key)}
                    className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                      active ? "bg-pink-600 text-white shadow-sm" : "text-gray-500 hover:bg-gray-100"
                    }`}
                  >
                    {tab.label}
                    <span
                      className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] ${
                        active ? "bg-white/25 text-white" : "bg-gray-100 text-gray-500"
                      }`}
                    >
                      {tab.count}
                    </span>
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              onClick={() => setSortOrder((s) => (s === "newest" ? "oldest" : "newest"))}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200/70 bg-white px-3 py-1.5 text-xs font-semibold text-gray-600 shadow-sm transition hover:border-pink-300 hover:text-pink-600"
              title="Ubah urutan tanggal"
            >
              {sortOrder === "newest" ? (
                <ArrowDownWideNarrow className="h-3.5 w-3.5" />
              ) : (
                <ArrowUpWideNarrow className="h-3.5 w-3.5" />
              )}
              {sortOrder === "newest" ? "Terbaru" : "Terlama"}
            </button>
          </div>

          {visibleItems.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-200 bg-white p-10 text-center">
              <p className="text-sm text-gray-400">
                {readFilter === "unread"
                  ? "Semua pengumuman sudah dibaca. 🎉"
                  : "Tidak ada pengumuman pada filter ini."}
              </p>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {visibleItems.map((item) => (
                <AnnouncementCard key={item.id} item={item} onOpen={() => openDetail(item)} />
              ))}
            </div>
          )}
        </>
      )}

      <AnnouncementDetailDialog id={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}
