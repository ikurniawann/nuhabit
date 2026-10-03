"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Flag, MapPin, Target, Trophy, Users } from "lucide-react";
import { DIVISION_LABELS, DIVISIONS, formatDuration, parseDuration, type Division } from "@/lib/gym/hyrox";
import { MEMBER_RACE_STATUS_LABELS, RACE_STATUS_LABELS, READINESS_TARGET_ACTIVITIES } from "@/lib/gym/races";
import type { MemberRaceView, RaceEventRow } from "@/lib/gym/races-server";
import { tanggal } from "../../format";
import { useLocale, useT, type T } from "../mobile-i18n";
import { BottomSheet } from "../mobile-sheets";
import { EmptyCard, ErrorNote, LoadingNote, OkNote, SectionHeader } from "../mobile-ui";
import { gymApi, GYM_KEYS, useRaceOverview } from "./gym-training-api";

/** Selisih bertanda: "−3:20" lebih cepat, "+1:05" lebih lambat. */
const signed = (sec: number) => `${sec <= 0 ? "−" : "+"}${formatDuration(Math.abs(sec))}`;

/**
 * Race HYROX untuk member: prediksi waktu dari simulasi penuh terbaik,
 * kesiapan 28 hari, race yang ditargetkan (target, hasil, analisis), dan
 * kalender race untuk didaftarkan sebagai target.
 *
 * `onStartSimulation` (opsional) menampilkan tombol ke generator workout saat
 * belum ada simulasi penuh untuk prediksi.
 */
export function RacesScreen({ onStartSimulation }: { onStartSimulation?: () => void }) {
  const t = useT();
  const locale = useLocale();
  const { data, isLoading, error } = useRaceOverview();
  const [registering, setRegistering] = useState<RaceEventRow | null>(null);
  const [managing, setManaging] = useState<MemberRaceView | null>(null);

  const myRaces = data?.my_races.filter((r) => r.status !== "cancelled") ?? [];

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="nh-display text-3xl font-black">{t("Race HYROX")}</h1>
        <p className="mt-1 text-sm text-nh-muted">{t("Pilih race, pasang target, dan pantau kesiapanmu.")}</p>
      </div>
      {isLoading && <LoadingNote />}
      {error && <ErrorNote>{error.message}</ErrorNote>}

      {data && (
        <section className="nh-surface-ink rounded-3xl p-5 text-white">
          <p className="text-[11px] font-extrabold tracking-[0.16em] text-white/50 uppercase">{t("Prediksi waktu race")}</p>
          <p className="nh-display mt-2 text-5xl tabular-nums">
            {data.prediction_sec ? formatDuration(data.prediction_sec) : "—"}
          </p>
          <p className="text-sm text-white/60">
            {data.best_simulation_sec
              ? t("Simulasi terbaik {time}, dikurangi 3% efek race day.", { time: formatDuration(data.best_simulation_sec) })
              : t("Selesaikan satu simulasi penuh untuk mendapat prediksi.")}
          </p>
          {!data.prediction_sec && onStartSimulation && (
            <button type="button" className="nh-btn-brand mt-4 w-full" onClick={onStartSimulation}>
              {t("Mulai simulasi penuh")}
            </button>
          )}
          <div className="mt-5">
            <div className="flex items-baseline justify-between text-xs">
              <span className="font-bold text-white/70">{t("Kesiapan 28 hari")}</span>
              <span className="font-black text-nh-lime">{data.readiness}%</span>
            </div>
            <div
              className="mt-2 h-2 overflow-hidden rounded-full bg-white/10"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={data.readiness}
              aria-label={t("Kesiapan 28 hari")}
            >
              <span className="block h-full rounded-full bg-nh-lime" style={{ width: `${data.readiness}%` }} />
            </div>
            <p className="mt-2 text-xs text-white/50">
              {t("{n} dari {target} sesi (workout atau kelas) dalam 4 minggu terakhir.", {
                n: data.activities_last_28d,
                target: READINESS_TARGET_ACTIVITIES,
              })}
            </p>
          </div>
        </section>
      )}

      {data && (
        <section>
          <SectionHeader label={t("Race saya")} />
          {myRaces.length === 0 ? (
            <EmptyCard>{t("Belum ada target race. Pilih dari kalender di bawah.")}</EmptyCard>
          ) : (
            <div className="flex flex-col gap-3">
              {myRaces.map((race) => (
                <MyRaceCard key={race.id} race={race} t={t} locale={locale} onOpen={() => setManaging(race)} />
              ))}
            </div>
          )}
        </section>
      )}

      {data && (
        <section>
          <SectionHeader label={t("Kalender race")} />
          {data.events.length === 0 ? (
            <EmptyCard>{t("Belum ada race terjadwal.")}</EmptyCard>
          ) : (
            <div className="flex flex-col gap-3">
              {data.events.map((event) => (
                <button
                  key={event.id}
                  type="button"
                  className="nh-card block w-full text-left active:scale-[0.99]"
                  onClick={() => (event.my_entry_id ? setManaging(myRaces.find((r) => r.id === event.my_entry_id) ?? null) : setRegistering(event))}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[10px] font-bold tracking-[0.18em] text-nh-muted uppercase">
                        {tanggal(event.starts_at, locale)}
                      </p>
                      <p className="nh-display mt-1 text-xl leading-tight">{event.name}</p>
                    </div>
                    <span
                      className={`nh-chip shrink-0 ${event.my_entry_id ? "bg-nh-lime text-nh-ink" : "bg-nh-raised text-nh-ink"}`}
                    >
                      {event.my_entry_id ? t("Target kamu") : t(RACE_STATUS_LABELS[event.status])}
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-nh-muted">
                    <span className="inline-flex items-center gap-1">
                      <MapPin size={13} /> {[event.venue, event.city].filter(Boolean).join(", ")}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Users size={13} /> {t("{n} member NüHabit", { n: event.entrant_count })}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      {registering && <RegisterSheet event={registering} onClose={() => setRegistering(null)} />}
      {managing && <ManageSheet race={managing} onClose={() => setManaging(null)} />}
    </div>
  );
}

function MyRaceCard({ race, t, locale, onOpen }: { race: MemberRaceView; t: T; locale: string; onOpen: () => void }) {
  const a = race.analysis;
  return (
    <button type="button" onClick={onOpen} className="nh-card block w-full text-left active:scale-[0.99]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-bold tracking-[0.18em] text-nh-muted uppercase">
            {tanggal(race.event.starts_at, locale)} · {DIVISION_LABELS[race.division]}
          </p>
          <p className="nh-display mt-1 text-xl leading-tight">{race.event.name}</p>
        </div>
        <span className={`nh-chip shrink-0 ${race.status === "raced" ? "bg-nh-lime text-nh-ink" : "bg-nh-raised text-nh-ink"}`}>
          {race.status === "raced"
            ? t(MEMBER_RACE_STATUS_LABELS.raced)
            : race.days_until > 0
              ? t("{n} hari lagi", { n: race.days_until })
              : t("Hari race")}
        </span>
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
        <Stat label={t("Target")} value={race.goal_sec ? formatDuration(race.goal_sec) : "—"} />
        <Stat label={t("Prediksi")} value={race.prediction_sec ? formatDuration(race.prediction_sec) : "—"} />
        <Stat label={t("Hasil")} value={race.result_sec ? formatDuration(race.result_sec) : "—"} strong />
      </dl>
      {a && (
        <p className={`mt-3 text-xs font-bold ${a.achievedGoal ? "text-nh-forest" : "text-nh-muted"}`}>
          {[
            a.achievedGoal === true && t("Target tercapai"),
            a.achievedGoal === false && t("Target belum tercapai"),
            a.vsGoalSec !== null && t("{d} vs target", { d: signed(a.vsGoalSec) }),
            a.vsPredictionSec !== null && t("{d} vs prediksi", { d: signed(a.vsPredictionSec) }),
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}
    </button>
  );
}

function Stat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="rounded-2xl bg-nh-raised px-2 py-2">
      <dt className="text-[10px] font-bold tracking-wider text-nh-muted uppercase">{label}</dt>
      <dd className={`text-sm tabular-nums ${strong ? "font-black" : "font-bold"}`}>{value}</dd>
    </div>
  );
}

function DivisionPicker({ value, onChange }: { value: Division; onChange: (d: Division) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {DIVISIONS.map((d) => (
        <button
          key={d}
          type="button"
          aria-pressed={value === d}
          onClick={() => onChange(d)}
          className={`nh-chip ${value === d ? "bg-nh-ink text-white" : "bg-nh-raised text-nh-ink"}`}
        >
          {DIVISION_LABELS[d]}
        </button>
      ))}
    </div>
  );
}

function useRefreshRaces() {
  const queryClient = useQueryClient();
  return () => void queryClient.invalidateQueries({ queryKey: GYM_KEYS.races });
}

function RegisterSheet({ event, onClose }: { event: RaceEventRow; onClose: () => void }) {
  const t = useT();
  const locale = useLocale();
  const refresh = useRefreshRaces();
  const [division, setDivision] = useState<Division>("MEN_OPEN");
  const [goal, setGoal] = useState("");
  const goalSec = goal.trim() ? parseDuration(goal) : null;
  const register = useMutation({
    mutationFn: () => gymApi.register({ race_event_id: event.id, division, goal_sec: goalSec }),
    onSuccess: () => {
      refresh();
      onClose();
    },
  });

  return (
    <BottomSheet kicker={tanggal(event.starts_at, locale)} title={event.name} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-nh-muted">
          {t("Jadikan race ini target latihan. Pendaftaran resmi tetap lewat situs penyelenggara.")}
        </p>
        <div>
          <p className="nh-label">{t("Divisi")}</p>
          <div className="mt-2">
            <DivisionPicker value={division} onChange={setDivision} />
          </div>
        </div>
        <label className="block">
          <span className="nh-label">{t("Target waktu (opsional)")}</span>
          <input
            className="nh-input mt-2 w-full"
            inputMode="numeric"
            placeholder="1:25:00"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
          />
          {goal.trim() && goalSec === null && (
            <span className="mt-1 block text-xs text-nh-danger">{t("Format jam:menit:detik, mis. 1:25:00")}</span>
          )}
        </label>
        {register.error && <ErrorNote>{register.error.message}</ErrorNote>}
        <button
          type="button"
          className="nh-btn-brand w-full"
          disabled={register.isPending || (goal.trim() !== "" && goalSec === null)}
          onClick={() => register.mutate()}
        >
          <Target size={16} /> {t("Jadikan target")}
        </button>
        {event.registration_url && (
          <a href={event.registration_url} target="_blank" rel="noreferrer" className="nh-btn-ghost w-full">
            <ExternalLink size={16} /> {t("Daftar di situs resmi")}
          </a>
        )}
      </div>
    </BottomSheet>
  );
}

function ManageSheet({ race, onClose }: { race: MemberRaceView; onClose: () => void }) {
  const t = useT();
  const locale = useLocale();
  const refresh = useRefreshRaces();
  const [goal, setGoal] = useState(race.goal_sec ? formatDuration(race.goal_sec) : "");
  const [division, setDivision] = useState<Division>(race.division);
  const [result, setResult] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  const goalSec = goal.trim() ? parseDuration(goal) : null;
  const resultSec = result.trim() ? parseDuration(result) : null;
  const raceStarted = race.days_until === 0;

  const update = useMutation({
    mutationFn: (body: Parameters<typeof gymApi.updateRace>[1]) => gymApi.updateRace(race.id, body),
    onSuccess: (_data, body) => {
      refresh();
      if (body.cancel || body.result_sec) onClose();
      else setSaved(t("Target disimpan."));
    },
  });

  if (race.status === "raced") {
    return (
      <BottomSheet kicker={tanggal(race.event.starts_at, locale)} title={race.event.name} onClose={onClose}>
        <div className="nh-surface-brand rounded-3xl p-5">
          <p className="text-[11px] font-extrabold tracking-[0.16em] uppercase opacity-60">{t("Hasil race")}</p>
          <p className="nh-display mt-2 text-5xl tabular-nums">{formatDuration(race.result_sec ?? 0)}</p>
          {race.analysis?.achievedGoal && (
            <p className="mt-1 inline-flex items-center gap-1 text-sm font-bold">
              <Trophy size={14} /> {t("Target tercapai")}
            </p>
          )}
        </div>
      </BottomSheet>
    );
  }

  return (
    <BottomSheet kicker={tanggal(race.event.starts_at, locale)} title={race.event.name} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div>
          <p className="nh-label">{t("Divisi")}</p>
          <div className="mt-2">
            <DivisionPicker value={division} onChange={setDivision} />
          </div>
        </div>
        <label className="block">
          <span className="nh-label">{t("Target waktu")}</span>
          <input
            className="nh-input mt-2 w-full"
            inputMode="numeric"
            placeholder="1:25:00"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
          />
        </label>
        {saved && <OkNote>{saved}</OkNote>}
        <button
          type="button"
          className="nh-btn-ghost w-full"
          disabled={update.isPending || (goal.trim() !== "" && goalSec === null)}
          onClick={() => update.mutate({ division, goal_sec: goalSec })}
        >
          {t("Simpan target")}
        </button>

        <div className="nh-card flex flex-col gap-3">
          <p className="text-sm font-extrabold">
            <Flag size={14} className="mr-1 inline" /> {t("Catat hasil race")}
          </p>
          {raceStarted ? (
            <>
              <input
                className="nh-input w-full"
                inputMode="numeric"
                placeholder="1:22:45"
                aria-label={t("Waktu finis")}
                value={result}
                onChange={(e) => setResult(e.target.value)}
              />
              <button
                type="button"
                className="nh-btn-brand w-full"
                disabled={update.isPending || resultSec === null}
                onClick={() => resultSec && update.mutate({ result_sec: resultSec })}
              >
                {t("Simpan hasil")}
              </button>
            </>
          ) : (
            <p className="text-xs text-nh-muted">{t("Hasil bisa dicatat mulai hari race.")}</p>
          )}
        </div>

        {update.error && <ErrorNote>{update.error.message}</ErrorNote>}
        <button
          type="button"
          className="text-xs font-bold text-nh-danger"
          disabled={update.isPending}
          onClick={() => update.mutate({ cancel: true })}
        >
          {t("Batalkan target race ini")}
        </button>
      </div>
    </BottomSheet>
  );
}
