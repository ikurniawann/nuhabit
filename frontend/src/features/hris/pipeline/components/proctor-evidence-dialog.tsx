"use client";

import type { ReactNode } from "react";
import {
  AlertTriangle,
  Camera,
  CameraOff,
  ClipboardPaste,
  Expand,
  Loader2,
  ScanFace,
  Users,
  WifiOff,
} from "lucide-react";
import {
  Dialog,
  DialogPanel,
  DialogPanelBody,
  DialogPanelHeader,
  DialogPanelTitle,
  DialogPanelDescription,
} from "@/components/ui/dialog";
import { formatDate, formatTime } from "@/lib/format";
import { useInterviewProctorEvents, usePsikotesProctorEvents } from "../queries";
import type { InterviewAiSession, InterviewProctorEvent, PsikotesSession } from "../types";

type FlagType = Exclude<InterviewProctorEvent["event_type"], "webcam_snapshot">;

const FLAG_META: Record<FlagType, { label: string; icon: ReactNode }> = {
  tab_blur: { label: "Pindah tab / aplikasi", icon: <AlertTriangle className="size-3.5" /> },
  fullscreen_exit: { label: "Keluar layar penuh", icon: <Expand className="size-3.5" /> },
  paste: { label: "Paste terdeteksi", icon: <ClipboardPaste className="size-3.5" /> },
  disconnect: { label: "Koneksi terputus", icon: <WifiOff className="size-3.5" /> },
  face_not_detected: { label: "Wajah keluar frame", icon: <ScanFace className="size-3.5" /> },
  multiple_faces: { label: "Lebih dari satu wajah", icon: <Users className="size-3.5" /> },
  camera_off: { label: "Kamera dimatikan", icon: <CameraOff className="size-3.5" /> },
};

const SNAPSHOT_TRIGGER_NOTES: Record<string, string> = {
  face_not_detected: "saat keluar frame",
  multiple_faces: "saat >1 wajah",
};

interface ProctorEvidenceProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  events: InterviewProctorEvent[];
  loading: boolean;
  /** prefix file ber-auth: /api/psikotes/files atau /api/interview/files */
  filesBase: string;
  snapshotAlt: string;
  noFlagsText: string;
  noSnapshotsText: string;
}

/** Rekap flag perilaku berkelompok + galeri snapshot webcam (storage private). */
function ProctorEvidenceDialog({
  open,
  onOpenChange,
  title,
  description,
  events,
  loading,
  filesBase,
  snapshotAlt,
  noFlagsText,
  noSnapshotsText,
}: ProctorEvidenceProps) {
  const flags = events.filter(
    (e): e is InterviewProctorEvent & { event_type: FlagType } => e.event_type !== "webcam_snapshot"
  );
  const snapshots = events.filter((e) => e.event_type === "webcam_snapshot" && e.storage_path);
  const flagCounts = new Map<FlagType, number>();
  for (const e of flags) flagCounts.set(e.event_type, (flagCounts.get(e.event_type) ?? 0) + 1);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPanel size="lg">
        <DialogPanelHeader>
          <DialogPanelTitle>{title}</DialogPanelTitle>
          <DialogPanelDescription>{description}</DialogPanelDescription>
        </DialogPanelHeader>
        <DialogPanelBody className="space-y-4">
          {loading ? (
            <div className="flex justify-center py-10 text-muted-foreground">
              <Loader2 className="size-5 animate-spin" />
            </div>
          ) : events.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border py-8 text-center text-sm text-muted-foreground">
              Tidak ada flag maupun snapshot pada sesi ini.
            </p>
          ) : (
            <>
              <div>
                <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Flag Perilaku ({flags.length})
                </h4>
                {flags.length === 0 ? (
                  <p className="text-sm text-emerald-600 dark:text-emerald-400">{noFlagsText}</p>
                ) : (
                  <>
                    <div className="mb-2 flex flex-wrap gap-2">
                      {[...flagCounts].map(([type, count]) => (
                        <span
                          key={type}
                          className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800 dark:bg-amber-500/15 dark:text-amber-300"
                        >
                          {FLAG_META[type].icon}
                          {FLAG_META[type].label} × {count}
                        </span>
                      ))}
                    </div>
                    <ul className="max-h-48 divide-y divide-border overflow-y-auto rounded-lg border border-border text-sm">
                      {flags.map((event) => (
                        <li key={event.id} className="flex items-center justify-between px-3 py-1.5">
                          <span className="flex items-center gap-2 text-foreground/80">
                            {FLAG_META[event.event_type].icon}
                            {FLAG_META[event.event_type].label}
                            {event.meta?.offline_seconds != null && ` (${event.meta.offline_seconds} detik)`}
                            {event.meta?.faces != null && ` (${event.meta.faces} wajah)`}
                          </span>
                          <span className="text-xs text-muted-foreground">{formatTime(event.created_at)}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>

              <div>
                <h4 className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <Camera className="size-3.5" /> Snapshot Webcam ({snapshots.length})
                </h4>
                {snapshots.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{noSnapshotsText}</p>
                ) : (
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                    {snapshots.map((snapshot) => {
                      const trigger = SNAPSHOT_TRIGGER_NOTES[String(snapshot.meta?.trigger ?? "")];
                      return (
                        <figure key={snapshot.id} className="space-y-1">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={`${filesBase}/${snapshot.storage_path}`}
                            alt={snapshotAlt}
                            loading="lazy"
                            className="aspect-[4/3] w-full rounded-md border border-border object-cover"
                          />
                          <figcaption className="text-center text-[10px] text-muted-foreground">
                            {formatTime(snapshot.created_at)}
                            {trigger && (
                              <span className="block font-medium text-amber-600 dark:text-amber-400">
                                {trigger}
                              </span>
                            )}
                          </figcaption>
                        </figure>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </DialogPanelBody>
      </DialogPanel>
    </Dialog>
  );
}

interface SessionDialogProps<S> {
  session: S;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Arsip bukti proctoring satu sesi psikotes (EPIC-002 TG5). */
export function PsikotesProctorDialog({ session, open, onOpenChange }: SessionDialogProps<PsikotesSession>) {
  const eventsQuery = usePsikotesProctorEvents(open ? session.id : null);
  return (
    <ProctorEvidenceDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Arsip Bukti Proctoring"
      description={
        <>
          {session.invited_at && `Sesi ${formatDate(session.invited_at)} · `}
          consent kamera: {session.webcam_consent ? "diberikan" : "tidak diberikan"}
        </>
      }
      events={eventsQuery.data ?? []}
      loading={eventsQuery.isLoading}
      filesBase="/api/psikotes/files"
      snapshotAlt="Snapshot proctoring"
      noFlagsText="Tidak ada flag — kandidat tidak terdeteksi meninggalkan tes."
      noSnapshotsText={`Tidak ada snapshot${session.webcam_consent ? "" : " (kandidat tidak memberi consent kamera)"}.`}
    />
  );
}

/** Analitik proctoring interview AI (EPIC-003): tab, wajah, kamera + snapshot. */
export function InterviewProctorDialog({ session, open, onOpenChange }: SessionDialogProps<InterviewAiSession>) {
  const eventsQuery = useInterviewProctorEvents(open ? session.id : null);
  return (
    <ProctorEvidenceDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Analitik & Bukti Proctoring Interview"
      description={
        <>
          {session.invited_at && `Sesi ${formatDate(session.invited_at)} · `}
          interview wajib on-cam — kamera aktif sepanjang sesi
        </>
      }
      events={eventsQuery.data ?? []}
      loading={eventsQuery.isLoading}
      filesBase="/api/interview/files"
      snapshotAlt="Snapshot proctoring interview"
      noFlagsText="Tidak ada flag — kandidat on-cam dan tidak terdeteksi meninggalkan interview."
      noSnapshotsText="Tidak ada snapshot pada sesi ini."
    />
  );
}
