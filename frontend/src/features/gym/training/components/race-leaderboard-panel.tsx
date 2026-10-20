"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BadgeCheck, Crown } from "lucide-react";
import { Field, TableNote } from "@/features/crm/engagement/components/shared";
import { SELECT } from "@/features/gym/shared";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  AGE_GROUPS,
  HYROX_STATIONS,
  RESULT_DIVISIONS,
  RESULT_DIVISION_LABELS,
  formatSplit,
  type AgeGroup,
  type LeaderboardQuery,
  type ResultDivision,
  type ResultSource,
} from "@/lib/gym/hyrox-results";
import { formatDateTime } from "@/lib/format";
import { trainingApi, type RaceEventRow } from "../api";

/** Leaderboard HYROX gym: per race atau keseluruhan, per stasiun, tanpa member yang memilih tidak tampil. */
export function RaceLeaderboardPanel({ races }: { races: RaceEventRow[] }) {
  const [source, setSource] = useState<ResultSource>("race");
  const [raceId, setRaceId] = useState("");
  const [division, setDivision] = useState<ResultDivision | "">("");
  const [ageGroup, setAgeGroup] = useState<AgeGroup | "">("");
  const [year, setYear] = useState(0);
  const [station, setStation] = useState(0);
  const [includeUnverified, setIncludeUnverified] = useState(false);

  const query: LeaderboardQuery = {
    source,
    raceId: source === "race" ? raceId || undefined : undefined,
    division: division || undefined,
    ageGroup: ageGroup || undefined,
    year: year || undefined,
    station: station || undefined,
    includeUnverified,
  };
  const board = useQuery({ queryKey: ["gym", "race-leaderboard", query], queryFn: () => trainingApi.leaderboard(query) });
  const rows = board.data?.rows ?? [];

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Sumber">
          <select className={SELECT} value={source} onChange={(e) => setSource(e.target.value as ResultSource)}>
            <option value="race">Race</option>
            <option value="simulation">Simulasi di gym</option>
          </select>
        </Field>
        <Field label="Race">
          <select className={SELECT} value={raceId} disabled={source !== "race"} onChange={(e) => setRaceId(e.target.value)}>
            <option value="">Semua race</option>
            {races.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Papan">
          <select className={SELECT} value={station} onChange={(e) => setStation(Number(e.target.value))}>
            <option value={0}>Total waktu</option>
            {HYROX_STATIONS.map((s, i) => (
              <option key={s.name} value={i + 1}>
                {s.name} ({s.volume})
              </option>
            ))}
          </select>
        </Field>
        <Field label="Tahun">
          <select className={SELECT} value={year} onChange={(e) => setYear(Number(e.target.value))}>
            <option value={0}>Sepanjang waktu</option>
            {(board.data?.years ?? []).map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Divisi">
          <select className={SELECT} value={division} onChange={(e) => setDivision(e.target.value as ResultDivision | "")}>
            <option value="">Semua divisi</option>
            {RESULT_DIVISIONS.map((d) => (
              <option key={d} value={d}>
                {RESULT_DIVISION_LABELS[d]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Kelompok umur">
          <select className={SELECT} value={ageGroup} onChange={(e) => setAgeGroup(e.target.value as AgeGroup | "")}>
            <option value="">Semua umur</option>
            {AGE_GROUPS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </Field>
        <label className="flex items-center gap-3 self-end pb-2 text-sm sm:col-span-2">
          <Switch checked={includeUnverified} onCheckedChange={setIncludeUnverified} />
          Ikutkan hasil yang belum diverifikasi
        </label>
      </div>

      <Card className="py-0">
        {board.isLoading ? (
          <TableNote>Memuat leaderboard…</TableNote>
        ) : board.error ? (
          <TableNote tone="danger">{board.error.message}</TableNote>
        ) : rows.length === 0 ? (
          <TableNote>
            {includeUnverified
              ? "Belum ada hasil untuk filter ini."
              : "Belum ada hasil terverifikasi. Verifikasi hasil di tab Hasil atau ikutkan yang belum diverifikasi."}
          </TableNote>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">#</TableHead>
                <TableHead>Member</TableHead>
                <TableHead className="hidden md:table-cell">Race</TableHead>
                <TableHead className="hidden sm:table-cell">Divisi</TableHead>
                <TableHead className="text-right">Waktu</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.result_id}>
                  <TableCell className="font-medium tabular-nums">
                    <span className="inline-flex items-center gap-1">
                      {row.rank}
                      {row.rank === 1 && <Crown className="size-3.5 text-brand-text" aria-hidden />}
                    </span>
                  </TableCell>
                  <TableCell>
                    <p className="font-medium">{row.name}</p>
                    <p className="text-xs text-muted-foreground md:hidden">{row.race_name ?? "Simulasi HYROX"}</p>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <p>{row.race_name ?? "Simulasi HYROX"}</p>
                    <p className="text-xs text-muted-foreground">{formatDateTime(row.raced_at)}</p>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    {RESULT_DIVISION_LABELS[row.division]}
                    {row.age_group && <span className="block text-xs text-muted-foreground">{row.age_group}</span>}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    <span className="inline-flex items-center gap-1">
                      {includeUnverified && row.verified && (
                        <BadgeCheck className="size-3.5 text-success" aria-label="Terverifikasi" />
                      )}
                      {formatSplit(row.value_sec)}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
