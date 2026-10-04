"use client";

import Link from "next/link";
import { ArrowLeft, BrainCircuit, BotMessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLiveSessions } from "../queries";
import type { LiveSessionType } from "../api";
import { LiveCamCard } from "./live-cam-card";
import { LiveChatCard } from "./live-chat-card";

const TYPE_META = {
  psikotes: { label: "Psikotes", icon: <BrainCircuit className="size-4" /> },
  interview: { label: "Interview AI", icon: <BotMessageSquare className="size-4" /> },
} as const;

/**
 * Detail Live Monitoring satu sesi: live cam besar + live chat dua arah
 * dgn kandidat.
 */
export function LiveMonitorDetailPage({ type, sessionId }: { type: LiveSessionType; sessionId: string }) {
  const { data: sessions } = useLiveSessions();
  const session = sessions?.find((s) => s.session_type === type && s.session_id === sessionId) ?? null;
  const meta = TYPE_META[type];

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" asChild className="gap-1">
          <Link href="/dashboard/hris/live-monitoring">
            <ArrowLeft className="size-4" /> Live Monitoring
          </Link>
        </Button>
        <div>
          <h1 className="flex items-center gap-2 text-lg font-bold text-gray-900">
            {session?.candidate_name ?? "Kandidat"}
            <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
              {meta.icon} {meta.label}
            </span>
          </h1>
          {session?.position_title && <p className="text-xs text-gray-500">{session.position_title}</p>}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <LiveCamCard type={type} sessionId={sessionId} />
        <LiveChatCard type={type} sessionId={sessionId} />
      </div>
    </div>
  );
}
