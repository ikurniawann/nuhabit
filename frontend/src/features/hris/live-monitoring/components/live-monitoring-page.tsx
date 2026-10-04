"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BrainCircuit, BotMessageSquare, Loader2, MessageCircle, Video, VideoOff } from "lucide-react";
import { Card } from "@/components/ui/card";
import { elapsedLabel, isFrameStale } from "@/lib/recruitment/live-monitoring-view";
import { useLiveSessions } from "../queries";
import { liveFrameUrl, type LiveMonitorSession } from "../api";

const TYPE_META = {
  psikotes: {
    label: "Psikotes",
    icon: <BrainCircuit className="size-3.5" />,
    badge: "bg-violet-100 text-violet-800",
  },
  interview: {
    label: "Interview AI",
    icon: <BotMessageSquare className="size-3.5" />,
    badge: "bg-blue-100 text-blue-800",
  },
} as const;

/** Frame live yang refresh sendiri; onError → tampilkan placeholder. */
function LiveThumbnail({
  session,
  tick,
  now,
}: {
  session: LiveMonitorSession;
  tick: number;
  now: number;
}) {
  const [failed, setFailed] = useState(false);
  const hasFrame = Boolean(session.frame_updated_at) && !failed;
  const stale = isFrameStale(session.frame_updated_at, now);

  return (
    <div className="relative aspect-[4/3] w-full overflow-hidden rounded-t-xl bg-gray-900">
      {hasFrame ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={liveFrameUrl(session.session_type, session.session_id, tick)}
          alt={`Live cam ${session.candidate_name}`}
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="flex h-full items-center justify-center text-gray-500">
          <VideoOff className="size-8" />
        </div>
      )}
      <span
        className={`absolute left-2 top-2 flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold text-white ${
          hasFrame && !stale ? "bg-red-600" : "bg-gray-600"
        }`}
      >
        <span className={`size-1.5 rounded-full bg-white ${hasFrame && !stale ? "animate-pulse" : ""}`} />
        {hasFrame && !stale ? "LIVE" : "OFFLINE"}
      </span>
      {session.last_message_at && session.last_message_sender === "candidate" && (
        <span className="absolute right-2 top-2 flex items-center gap-1 rounded bg-amber-500 px-1.5 py-0.5 text-[10px] font-semibold text-white">
          <MessageCircle className="size-3" /> chat
        </span>
      )}
    </div>
  );
}

/**
 * Live Monitoring rekrutmen (/dashboard/hris/live-monitoring): thumbnail
 * near-live semua kandidat yang sedang psikotes on-cam / interview AI.
 * Klik thumbnail → detail (live cam besar + live chat dgn kandidat).
 */
export function LiveMonitoringPage() {
  const { data: sessions, isLoading, isError, refetch } = useLiveSessions();
  const [tick, setTick] = useState(0);
  const [now, setNow] = useState(0);

  // refresh gambar frame tiap 4 detik (cache-busting query); pemanggilan
  // pertama lewat timeout 0 supaya tidak setState sinkron di dalam effect
  useEffect(() => {
    const bump = () => {
      setTick((t) => t + 1);
      setNow(Date.now());
    };
    const kickoff = setTimeout(bump, 0);
    const timer = setInterval(bump, 4_000);
    return () => {
      clearTimeout(kickoff);
      clearInterval(timer);
    };
  }, []);

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold text-gray-900 sm:text-2xl">
          <Video className="size-6 text-red-500" /> Live Monitoring
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          Pantau kandidat yang sedang mengerjakan psikotes on-cam & interview AI secara langsung —
          klik kartu untuk melihat live cam besar dan chat dengan kandidat.
        </p>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16 text-muted-foreground">
          <Loader2 className="size-6 animate-spin" />
        </div>
      ) : isError ? (
        <Card className="p-8 text-center">
          <p className="text-sm text-red-600">Gagal memuat sesi berjalan.</p>
          <button
            type="button"
            className="mt-2 text-sm font-medium text-blue-600 hover:underline"
            onClick={() => refetch()}
          >
            Coba lagi
          </button>
        </Card>
      ) : (sessions ?? []).length === 0 ? (
        <Card className="p-12 text-center">
          <VideoOff className="mx-auto mb-3 size-10 text-gray-300" />
          <p className="text-sm font-medium text-gray-700">Tidak ada sesi yang sedang berjalan</p>
          <p className="mt-1 text-xs text-gray-400">
            Kartu live akan muncul otomatis begitu kandidat memulai psikotes atau interview AI.
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {(sessions ?? []).map((session) => {
            const meta = TYPE_META[session.session_type];
            return (
              <Link
                key={`${session.session_type}-${session.session_id}`}
                href={`/dashboard/hris/live-monitoring/${session.session_type}/${session.session_id}`}
                className="group"
              >
                <Card className="overflow-hidden p-0 transition-shadow hover:shadow-lg">
                  <LiveThumbnail session={session} tick={tick} now={now} />
                  <div className="space-y-1 p-3">
                    <p className="truncate text-sm font-semibold text-gray-900 group-hover:text-blue-600">
                      {session.candidate_name}
                    </p>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium ${meta.badge}`}
                      >
                        {meta.icon} {meta.label}
                      </span>
                      {session.position_title && <span>{session.position_title}</span>}
                      {session.started_at && now > 0 && <span>· {elapsedLabel(session.started_at, now)}</span>}
                    </div>
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
