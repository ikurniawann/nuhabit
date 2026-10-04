"use client";

import Image from "next/image";
import { Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SafeHtml } from "@/components/hris/SafeHtml";
import { VideoEmbed } from "@/components/hris/VideoEmbed";
import { useAnnouncement } from "../queries";
import { announcementCoverSrc, announcementDate } from "./announcement-card";

const BODY_CLASS =
  "prose prose-sm max-w-none text-gray-700 [&_a]:text-pink-600 [&_h1]:text-xl [&_h2]:text-lg [&_h3]:text-base [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_blockquote]:border-l-4 [&_blockquote]:border-gray-200 [&_blockquote]:pl-3 [&_blockquote]:text-gray-500";

/** Detail pengumuman; gagal memuat menutup dialog (sama seperti sebelumnya). */
export function AnnouncementDetailDialog({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { data: detail, isError } = useAnnouncement(id);
  const cover = detail ? announcementCoverSrc(detail.cover_image_url) : null;

  return (
    <Dialog open={id !== null && !isError} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-3xl">
        {!detail ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-7 w-7 animate-spin text-gray-400" />
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="text-xl">{detail.title}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <p className="text-xs text-gray-400">
                {announcementDate(detail)}
                {detail.created_by_name ? ` · oleh ${detail.created_by_name}` : ""}
              </p>
              {detail.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {detail.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded bg-pink-50 px-2 py-0.5 text-xs font-medium text-pink-600"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
              {cover && (
                <Image
                  src={cover}
                  alt=""
                  width={1200}
                  height={675}
                  unoptimized
                  className="h-auto w-full rounded-xl object-cover"
                />
              )}
              <SafeHtml html={detail.body_html} className={BODY_CLASS} />
              <VideoEmbed provider={detail.video_provider} videoId={detail.video_id} />
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
