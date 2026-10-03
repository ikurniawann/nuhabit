"use client";

import { useState } from "react";
import { User } from "lucide-react";
import { useT } from "../mobile-i18n";
import { BottomSheet } from "../mobile-sheets";
import { EmptyCard, ErrorNote, LoadingNote, SectionHeader } from "../mobile-ui";
import { ClassCard, ClassSheet } from "./class-sheet";
import { useGymCoach, useGymCoaches, type GymCoach } from "./gym-classes-api";

/** Daftar coach; ketuk untuk profil + kelas 14 hari ke depan yang bisa langsung di-booking. */
export function CoachesScreen() {
  const t = useT();
  const { data, isLoading, error } = useGymCoaches();
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-5">
      <h1 className="nh-display text-3xl font-black">{t("Coach")}</h1>
      {isLoading && <LoadingNote />}
      {error && <ErrorNote>{error.message}</ErrorNote>}
      {data && data.length === 0 && <EmptyCard>{t("Belum ada coach.")}</EmptyCard>}
      {data?.map((coach) => (
        <button
          key={coach.id}
          type="button"
          onClick={() => setOpenId(coach.id)}
          className="nh-card flex w-full items-center gap-3 text-left active:scale-[0.99]"
        >
          <Avatar coach={coach} />
          <div className="min-w-0 flex-1">
            <p className="nh-display text-lg leading-tight">{coach.name}</p>
            <p className="text-xs text-nh-muted">{coach.specialization}</p>
          </div>
          <span className="nh-chip shrink-0 bg-nh-raised text-nh-ink">
            {t("{n} kelas", { n: coach.upcoming_sessions })}
          </span>
        </button>
      ))}
      {openId && <CoachSheet coachId={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}

function Avatar({ coach }: { coach: Pick<GymCoach, "name" | "photo_url"> }) {
  return coach.photo_url ? (
    // eslint-disable-next-line @next/next/no-img-element -- URL foto bebas dari admin, bukan aset lokal
    <img src={coach.photo_url} alt="" className="size-12 shrink-0 rounded-full object-cover" />
  ) : (
    <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-nh-lime text-nh-ink">
      <User size={20} />
    </span>
  );
}

function CoachSheet({ coachId, onClose }: { coachId: string; onClose: () => void }) {
  const t = useT();
  const { data, isLoading, error } = useGymCoach(coachId);
  const [classId, setClassId] = useState<string | null>(null);

  if (classId) return <ClassSheet sessionId={classId} onClose={() => setClassId(null)} />;
  return (
    <BottomSheet kicker={data?.specialization} title={data?.name ?? t("Coach")} onClose={onClose}>
      {isLoading && <LoadingNote />}
      {error && <ErrorNote>{error.message}</ErrorNote>}
      {data && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <Avatar coach={data} />
            <p className="text-sm whitespace-pre-line text-nh-ink/80">{data.bio}</p>
          </div>
          <SectionHeader label={t("Kelas mendatang")} />
          {data.sessions.length === 0 && <EmptyCard>{t("Belum ada kelas terjadwal.")}</EmptyCard>}
          {data.sessions.map((session) => (
            <ClassCard key={session.id} session={session} onOpen={() => setClassId(session.id)} />
          ))}
        </div>
      )}
    </BottomSheet>
  );
}
