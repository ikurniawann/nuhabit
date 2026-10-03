"use client";

import { useState } from "react";
import { Coins } from "lucide-react";
import { useLocale, useT } from "../mobile-i18n";
import { EmptyCard, ErrorNote, LoadingNote } from "../mobile-ui";
import { ClassCard, ClassSheet } from "./class-sheet";
import { useGymClasses, wibDays } from "./gym-classes-api";

/**
 * Jadwal kelas: strip 7 hari, filter jenis kelas, kartu sesi, dan lembar
 * booking. `onBuyCredits` (opsional) membuka layar beli kredit saat saldo kurang.
 */
export function ClassesScreen({ onBuyCredits }: { onBuyCredits?: () => void }) {
  const t = useT();
  const locale = useLocale();
  const days = wibDays(7);
  const [day, setDay] = useState(days[0]);
  const [classTypeId, setClassTypeId] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const { data, isLoading, error } = useGymClasses(day, classTypeId);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="nh-display text-3xl font-black">{t("Kelas")}</h1>
          <p className="mt-1 text-sm text-nh-muted">{t("Booking dulu, kredit dipotong saat check-in.")}</p>
        </div>
        {data && (
          <span className="nh-chip inline-flex shrink-0 items-center gap-1 bg-nh-ink text-white">
            <Coins size={13} /> {t("{n} kredit", { n: data.credits })}
          </span>
        )}
      </div>

      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" role="tablist" aria-label={t("Pilih hari")}>
        {days.map((d) => {
          const date = new Date(`${d}T12:00:00+07:00`);
          const active = d === day;
          return (
            <button
              key={d}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setDay(d)}
              className={`flex w-14 shrink-0 flex-col items-center rounded-2xl py-2 ${
                active ? "bg-nh-ink text-white" : "bg-nh-raised text-nh-ink"
              }`}
            >
              <span className="text-[10px] font-bold tracking-[0.12em] uppercase opacity-70">
                {date.toLocaleDateString(locale, { weekday: "short", timeZone: "Asia/Jakarta" })}
              </span>
              <span className="nh-display text-xl">
                {date.toLocaleDateString(locale, { day: "numeric", timeZone: "Asia/Jakarta" })}
              </span>
            </button>
          );
        })}
      </div>

      {data && data.class_types.length > 1 && (
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1">
          {[{ id: "", name: t("Semua") }, ...data.class_types].map((type) => (
            <button
              key={type.id || "all"}
              type="button"
              onClick={() => setClassTypeId(type.id)}
              className={`nh-chip shrink-0 ${classTypeId === type.id ? "bg-nh-lime text-nh-ink" : "bg-nh-raised text-nh-muted"}`}
            >
              {type.name}
            </button>
          ))}
        </div>
      )}

      {isLoading && <LoadingNote>{t("Memuat jadwal…")}</LoadingNote>}
      {error && <ErrorNote>{error.message}</ErrorNote>}
      {data && data.sessions.length === 0 && <EmptyCard>{t("Tidak ada kelas yang bisa di-booking di hari ini.")}</EmptyCard>}
      {data?.sessions.map((session) => (
        <ClassCard key={session.id} session={session} onOpen={() => setOpenId(session.id)} />
      ))}
      {openId && <ClassSheet sessionId={openId} onClose={() => setOpenId(null)} onBuyCredits={onBuyCredits} />}
    </div>
  );
}
