"use client";

import { ArrowLeft, ClipboardPaste } from "lucide-react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import {
  AGE_GROUPS,
  HYROX_STATIONS,
  RESULT_DIVISIONS,
  RESULT_DIVISION_LABELS,
  SPLIT_COUNT,
  TOTAL_TOLERANCE_SEC,
  formatSplit,
  parseResultsPaste,
  parseSplit,
  splitsTotal,
  type AgeGroup,
  type HyroxResult,
  type ResultDivision,
  type ResultSource,
} from "@/lib/gym/hyrox-results";
import { ApiError } from "../lib/api";
import { useT } from "../lib/i18n";
import { m } from "../lib/links";
import { resultsApi, useInvalidateAll, useMyResults, type MyResults } from "../lib/queries-workout";
import { Spinner, formatDay, formatDuration } from "../ui";

const optionClass = (active: boolean) =>
  `rounded-xl border px-3 py-2 text-sm font-black uppercase ${
    active ? "border-nh-forest bg-nh-forest/10 text-nh-forest" : "border-nh-line bg-nh-cream text-nh-muted"
  }`;

const empty = () => Array<string>(SPLIT_COUNT).fill("");
const asText = (list: (number | null)[]) => list.map(formatSplit);

/** New result (?race= or ?session= preselects) and edit of an existing one. useSearchParams needs Suspense. */
export function ResultFormPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <ResultFormLoader />
    </Suspense>
  );
}

function ResultFormLoader() {
  const t = useT();
  const { resultId = "" } = useParams<{ resultId?: string }>();
  const searchParams = useSearchParams();
  const { data, isLoading, error } = useMyResults();

  if (error) return <p className="nh-card text-sm text-nh-muted">{error.message}</p>;
  if (isLoading || !data) return <Spinner label={t("Loading results…")} />;
  const existing = resultId ? data.results.find((r) => r.id === resultId) : undefined;
  if (resultId && !existing) return <p className="nh-card text-sm text-nh-muted">{t("Result not found.")}</p>;
  return (
    <ResultForm
      options={data}
      existing={existing}
      raceId={searchParams.get("race") ?? ""}
      sessionId={searchParams.get("session") ?? ""}
    />
  );
}

function ResultForm({
  options,
  existing,
  raceId,
  sessionId,
}: {
  options: MyResults;
  existing?: HyroxResult;
  raceId: string;
  sessionId: string;
}) {
  const t = useT();
  const router = useRouter();
  const invalidate = useInvalidateAll();
  const preselectedSim = options.simulations.find((s) => s.session_id === sessionId);
  const preselectedRace = options.races.find((r) => r.id === raceId) ?? options.races[0];

  const [source, setSource] = useState<ResultSource>(
    existing?.source ?? (preselectedSim || (!preselectedRace && options.simulations.length > 0) ? "simulation" : "race")
  );
  const [race, setRace] = useState(preselectedRace?.id ?? "");
  const [session, setSession] = useState(preselectedSim?.session_id ?? "");
  const [division, setDivision] = useState<ResultDivision>(
    existing?.division ?? preselectedSim?.division ?? preselectedRace?.division ?? "MEN_OPEN"
  );
  const [ageGroup, setAgeGroup] = useState<AgeGroup | "">(existing?.age_group ?? "");
  const [runs, setRuns] = useState(() =>
    existing ? asText(existing.run_sec) : preselectedSim ? asText(preselectedSim.run_sec) : empty()
  );
  const [stations, setStations] = useState(() =>
    existing ? asText(existing.station_sec) : preselectedSim ? asText(preselectedSim.station_sec) : empty()
  );
  const [roxzone, setRoxzone] = useState(formatSplit(existing?.roxzone_sec ?? null));
  const [total, setTotal] = useState(
    formatSplit(existing?.official_total_sec ?? (preselectedSim && !existing ? preselectedSim.active_sec : null))
  );
  const [paste, setPaste] = useState("");
  const [pasteOpen, setPasteOpen] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const pickSimulation = (id: string) => {
    setSession(id);
    const sim = options.simulations.find((s) => s.session_id === id);
    if (!sim) return;
    setRuns(asText(sim.run_sec));
    setStations(asText(sim.station_sec));
    setDivision(sim.division);
    setTotal(formatSplit(sim.active_sec));
  };

  const fillFromPaste = () => {
    const got = parseResultsPaste(paste);
    setRuns(asText(got.runs));
    setStations(asText(got.stations));
    if (got.roxzone !== null) setRoxzone(formatSplit(got.roxzone));
    if (got.total !== null) setTotal(formatSplit(got.total));
    setPasteOpen(false);
  };

  // A typed value that does not parse blocks saving; an empty one is a skipped split.
  const read = (text: string) => (text.trim() === "" ? null : parseSplit(text));
  const invalid = (text: string) => text.trim() !== "" && parseSplit(text) === null;
  const runSec = runs.map(read);
  const stationSec = stations.map(read);
  const sum = splitsTotal(runSec, stationSec, read(roxzone));
  const official = read(total);
  const gap = sum !== null && official !== null ? official - sum : null;
  const anyInvalid = [...runs, ...stations, roxzone, total].some(invalid);

  const save = async () => {
    if (anyInvalid) {
      setError(t("Use m:ss for splits, for example 4:12."));
      return;
    }
    if (official === null && sum === null) {
      setError(t("Enter the official total or all 8 runs and 8 stations."));
      return;
    }
    setBusy(true);
    setError("");
    const fields = {
      division,
      age_group: ageGroup || null,
      run_sec: runSec,
      station_sec: stationSec,
      roxzone_sec: read(roxzone),
      official_total_sec: official,
    };
    try {
      const { id } = existing
        ? await resultsApi.update(existing.id, fields)
        : await resultsApi.create({
            ...fields,
            source,
            race_event_id: source === "race" ? race : null,
            workout_session_id: source === "simulation" ? session : null,
          });
      invalidate();
      router.replace(m(`/races/results/${id}`));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("Could not save result."));
      setBusy(false);
    }
  };

  const nothingToLog = !existing && options.races.length === 0 && options.simulations.length === 0;
  const subjectMissing = !existing && (source === "race" ? !race : !session);

  return (
    <div className="flex flex-col gap-5">
      <button onClick={() => router.back()} className="flex items-center gap-1 text-sm font-bold text-nh-muted">
        <ArrowLeft size={16} /> {t("Back")}
      </button>
      <div>
        <h1 className="nh-display text-3xl">{existing ? t("Edit result") : t("Log HYROX result")}</h1>
        <p className="text-sm text-nh-muted">
          {existing
            ? (existing.race_name ?? t("HYROX simulation"))
            : t("8 runs, 8 stations and Roxzone. Leave a split empty if you do not know it.")}
        </p>
      </div>

      {nothingToLog ? (
        <p className="nh-card text-sm text-nh-muted">
          {t("No race or full simulation to log yet. Races show up here once they start.")}
        </p>
      ) : (
        <>
          {existing ? (
            existing.verified ? (
              <p className="nh-card text-sm font-bold text-nh-warn">
                {t("Saving changes removes the verified badge until staff check the result again.")}
              </p>
            ) : null
          ) : (
            <div className="nh-card flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-2">
                {(["race", "simulation"] as const).map((s) => (
                  <button key={s} onClick={() => setSource(s)} className={optionClass(source === s)}>
                    {s === "race" ? t("Race") : t("Simulation")}
                  </button>
                ))}
              </div>
              {source === "race" ? (
                options.races.length ? (
                  <select className="nh-input" value={race} onChange={(e) => setRace(e.target.value)}>
                    {options.races.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name} · {formatDay(r.starts_at)}
                      </option>
                    ))}
                  </select>
                ) : (
                  <p className="text-sm text-nh-muted">{t("No started race without a result.")}</p>
                )
              ) : options.simulations.length ? (
                <select className="nh-input" value={session} onChange={(e) => pickSimulation(e.target.value)}>
                  <option value="">{t("Pick a full simulation")}</option>
                  {options.simulations.map((s) => (
                    <option key={s.session_id} value={s.session_id}>
                      {formatDay(s.ended_at)} · {formatDuration(s.active_sec)}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="text-sm text-nh-muted">{t("No completed full simulation to log.")}</p>
              )}
            </div>
          )}

          <div className="nh-card flex flex-col gap-3">
            <div>
              <p className="nh-label">{t("Division")}</p>
              <select
                className="nh-input"
                value={division}
                onChange={(e) => setDivision(e.target.value as ResultDivision)}
              >
                {RESULT_DIVISIONS.map((d) => (
                  <option key={d} value={d}>
                    {RESULT_DIVISION_LABELS[d]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <p className="nh-label">{t("Age group (optional)")}</p>
              <select className="nh-input" value={ageGroup} onChange={(e) => setAgeGroup(e.target.value as AgeGroup | "")}>
                <option value="">-</option>
                {AGE_GROUPS.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="nh-card flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
              <p className="nh-label !mb-0">{t("Splits (m:ss)")}</p>
              <button
                onClick={() => setPasteOpen((open) => !open)}
                className="flex items-center gap-1 text-xs font-black uppercase text-nh-forest"
              >
                <ClipboardPaste size={14} /> {t("Paste results")}
              </button>
            </div>
            {pasteOpen ? (
              <div className="flex flex-col gap-2">
                <textarea
                  className="nh-input min-h-32 font-mono text-xs"
                  value={paste}
                  onChange={(e) => setPaste(e.target.value)}
                  placeholder={"Running 1 4:05\nSkiErg 4:30\n…\nRoxzone 7:45\nTotal 1:22:33"}
                />
                <p className="text-xs text-nh-muted">
                  {t("Copy the split list from the results site. Lines without a label are read in race order.")}
                </p>
                <button className="nh-btn-ghost !py-2 text-sm" onClick={fillFromPaste} disabled={!paste.trim()}>
                  {t("Fill splits")}
                </button>
              </div>
            ) : null}
            <div className="grid grid-cols-[auto_1fr_1fr] items-start gap-x-2 gap-y-2 text-sm">
              <span />
              <span className="nh-label !mb-0">{t("Run 1 km")}</span>
              <span className="nh-label !mb-0">{t("Station")}</span>
              {HYROX_STATIONS.map((station, i) => (
                <SplitRow
                  key={station.name}
                  index={i}
                  station={`${station.name} ${station.volume}`}
                  run={runs[i]!}
                  stationValue={stations[i]!}
                  onRun={(v) => setRuns((cur) => cur.map((x, j) => (j === i ? v : x)))}
                  onStation={(v) => setStations((cur) => cur.map((x, j) => (j === i ? v : x)))}
                  invalid={invalid}
                />
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col">
                <span className="nh-label">{t("Roxzone")}</span>
                <SplitInput value={roxzone} onChange={setRoxzone} invalid={invalid(roxzone)} label={t("Roxzone")} />
              </label>
              <label className="flex flex-col">
                <span className="nh-label">{t("Official total")}</span>
                <SplitInput value={total} onChange={setTotal} invalid={invalid(total)} label={t("Official total")} placeholder="1:15:00" />
              </label>
            </div>
            <div className="rounded-xl bg-nh-raised p-3 text-sm">
              <p className="flex justify-between font-bold">
                <span>{t("Splits total")}</span>
                <span className="tabular-nums">{sum === null ? "-" : formatDuration(sum)}</span>
              </p>
              {gap !== null && Math.abs(gap) > TOTAL_TOLERANCE_SEC ? (
                <p className="mt-1 text-xs font-bold text-nh-warn">
                  {t("The official total is {gap} {direction} the splits. Both are kept; staff see the gap.", {
                    gap: formatDuration(Math.abs(gap)),
                    direction: gap > 0 ? t("above") : t("below"),
                  })}
                </p>
              ) : null}
            </div>
          </div>

          {error ? <p className="text-sm font-bold text-nh-danger">{error}</p> : null}
          <button className="nh-btn-brand" disabled={busy || subjectMissing} onClick={() => void save()}>
            {existing ? t("Save changes") : t("Save result")}
          </button>
        </>
      )}
    </div>
  );
}

function SplitRow({
  index,
  station,
  run,
  stationValue,
  onRun,
  onStation,
  invalid,
}: {
  index: number;
  station: string;
  run: string;
  stationValue: string;
  onRun: (v: string) => void;
  onStation: (v: string) => void;
  invalid: (text: string) => boolean;
}) {
  const t = useT();
  return (
    <>
      <span className="w-5 pt-2.5 font-black text-nh-muted">{index + 1}</span>
      <SplitInput value={run} onChange={onRun} invalid={invalid(run)} label={t("Run {n}", { n: index + 1 })} />
      <div>
        <SplitInput value={stationValue} onChange={onStation} invalid={invalid(stationValue)} label={station} />
        <p className="mt-0.5 truncate text-[11px] font-bold text-nh-muted">{station}</p>
      </div>
    </>
  );
}

function SplitInput({
  value,
  onChange,
  invalid,
  label,
  placeholder = "4:30",
}: {
  value: string;
  onChange: (v: string) => void;
  invalid: boolean;
  label: string;
  placeholder?: string;
}) {
  return (
    <input
      className={`nh-input w-full tabular-nums ${invalid ? "!border-nh-danger" : ""}`}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      inputMode="numeric"
      aria-label={label}
      aria-invalid={invalid}
    />
  );
}
