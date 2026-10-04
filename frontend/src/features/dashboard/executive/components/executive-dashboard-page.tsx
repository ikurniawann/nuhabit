"use client";

import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, Banknote, CalendarClock, ClipboardCheck, Inbox, ReceiptText, UserPlus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { IconTile, StatCard } from "@/components/ui/stat-card";
import { cn } from "@/lib/utils";
import type { SalesTargetConfig } from "@/lib/dashboard/sales-target";
import { compareWeeks } from "@/lib/dashboard/executive-view";
import { formatRupiahCompact, formatTime } from "@/lib/format";
import { executiveDashboardKey, useExecutiveDashboard } from "../queries";
import { Delta, FailedNote, SectionCard, TargetBar } from "./executive-parts";
import { GymTodayCard } from "./gym-today-card";
import { TargetEditor } from "./target-editor";
import { ExecutiveModuleSections } from "./executive-module-sections";

const NO_TARGET: SalesTargetConfig = { harianRp: 0, bulananRp: 0 };

/**
 * Dashboard eksekutif /dashboard (EPIC-021) — super_admin + direksi.
 * High-level & taktis lintas modul: setiap angka berpembanding dan ber-deep-link,
 * analisis dalam tetap di dashboard modul masing-masing.
 * Halaman referensi gaya WIT (docs/frontend-conventions.md).
 */

const DAY_SHORT = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];

export function ExecutiveDashboardPage() {
  const queryClient = useQueryClient();
  const dashboardQuery = useExecutiveDashboard();
  const data = dashboardQuery.data?.data ?? null;
  const target = dashboardQuery.data?.target ?? NO_TARGET;
  // Galat hanya ditampilkan bila belum pernah ada data; refresh berikutnya tetap jalan.
  const error =
    dashboardQuery.error instanceof Error ? dashboardQuery.error.message : null;
  const load = () => dashboardQuery.refetch();
  const setTarget = (next: SalesTargetConfig) =>
    queryClient.setQueryData(
      executiveDashboardKey,
      (prev: typeof dashboardQuery.data) =>
        prev ? { ...prev, target: next } : prev,
    );

  if (error && !data) {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-card bg-card p-5 shadow-card">
        <IconTile tone="danger">
          <Inbox />
        </IconTile>
        <div className="min-w-[12rem] flex-1">
          <p className="text-sm font-semibold text-foreground">
            Ringkasan belum bisa dimuat
          </p>
          <p className="text-xs text-muted-foreground">{error}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => load()}>
          Coba lagi
        </Button>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Memuat ringkasan">
        <div className="h-8 w-64 animate-pulse rounded-full bg-card" />
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
          <div className="h-56 animate-pulse rounded-hero bg-card" />
          <div className="grid grid-cols-2 gap-3 sm:gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="h-28 animate-pulse rounded-card bg-card"
              />
            ))}
          </div>
        </div>
        <div className="h-56 animate-pulse rounded-card bg-card" />
      </div>
    );
  }

  const o = data.overview;
  const failed = new Set(data.gagal);
  const pulsa = o.pulsaBisnis;
  const tim = o.timHariIni;
  const keputusan = o.perluKeputusan;
  const tren = data.tren14Hari;

  // Insight mingguan: 7 hari terakhir vs 7 hari sebelumnya.
  const minggu = tren ? compareWeeks(tren) : null;
  const maxOmzet = tren ? Math.max(...tren.map((p) => p.omzet), 1) : 1;

  const antrean = keputusan
    ? [
        {
          t: "Pengajuan cuti",
          n: keputusan.cuti,
          href: "/dashboard/hris/leaves",
          icon: <CalendarClock />,
        },
        {
          t: "Pengajuan lembur",
          n: keputusan.lembur,
          href: "/dashboard/hris/overtime",
          icon: <ClipboardCheck />,
        },
        {
          t: "Pengajuan pinjaman",
          n: keputusan.pinjaman,
          href: "/dashboard/hris/loans",
          icon: <Banknote />,
        },
        {
          t: "PO draft",
          n: keputusan.poDraft,
          href: "/dashboard/purchasing/approval",
          icon: <ReceiptText />,
        },
        {
          t: "Kandidat baru",
          n: keputusan.kandidatBaru,
          href: "/dashboard/hris/candidates",
          icon: <UserPlus />,
        },
      ]
    : [];
  const antreanAktif = antrean.filter((r) => r.n > 0);

  return (
    <div className="space-y-4">
      <PageHeader
        kicker="Beranda"
        title="Ringkasan Eksekutif"
        description="Seluruh modul dalam satu layar. Angka mengikuti definisi modulnya, klik untuk mendalami."
        actions={
          <p className="text-xs text-muted-foreground">
            Diperbarui {formatTime(data.dibuatPada)} · otomatis tiap 60 detik
          </p>
        }
      />

      {/* Perlu perhatian: satu tile per antrean yang tidak kosong */}
      {failed.has("overview:perluKeputusan") ? (
        <FailedNote />
      ) : (
        keputusan && (
          <Card size="sm" className="xl:flex-row xl:items-center">
            <CardHeader className="xl:w-56 xl:shrink-0">
              <CardTitle>
                <h2>Perlu keputusan</h2>
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                {keputusan.total > 0
                  ? `${keputusan.total} pengajuan dan dokumen menunggu persetujuan`
                  : "Tidak ada yang menunggu persetujuan"}
              </p>
            </CardHeader>
            <CardContent className="xl:flex-1 xl:pl-0">
              {antreanAktif.length === 0 ? (
                <p className="rounded-2xl bg-success-soft px-3 py-2.5 text-sm text-success">
                  Semua antrean persetujuan kosong.
                </p>
              ) : (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
                  {antreanAktif.map((r) => (
                    <Link
                      key={r.t}
                      href={r.href}
                      className="flex items-center gap-3 rounded-2xl bg-accent-soft p-3 transition-colors hover:bg-accent/15 focus-visible:ring-2 focus-visible:ring-forest/40 focus-visible:outline-none active:scale-[0.98]"
                    >
                      <IconTile tone="accent" size="sm">
                        {r.icon}
                      </IconTile>
                      <span className="min-w-0">
                        <span className="block text-lg leading-none font-bold text-foreground tabular-nums">
                          {r.n}
                        </span>
                        <span className="mt-1 block truncate text-xs text-muted-foreground">
                          {r.t}
                        </span>
                      </span>
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )
      )}

      {/* Hero: omzet hari ini di ink, tiga stat di sampingnya */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Card variant="ink" className="p-6 py-6">
          {failed.has("overview:pulsaBisnis") ? (
            <FailedNote />
          ) : (
            pulsa && (
              <div className="flex h-full flex-col gap-5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-[11px] font-semibold tracking-wider text-on-ink-muted uppercase">
                      Omzet hari ini
                    </p>
                    <p className="mt-2 text-5xl leading-none font-bold tracking-tight tabular-nums">
                      {formatRupiahCompact(pulsa.hariIni.omzet)}
                    </p>
                  </div>
                  <Link
                    href="/dashboard/pos"
                    className="inline-flex h-8 items-center gap-1 rounded-full bg-white/10 px-3 text-xs font-semibold text-white transition-colors hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:outline-none"
                  >
                    Point of Sales
                    <ArrowUpRight className="size-3.5" />
                  </Link>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Delta
                    now={pulsa.hariIni.omzet}
                    before={pulsa.kemarin.omzet}
                    label="vs kemarin"
                    onInk
                  />
                  {tren && tren.length === 14 && (
                    <Delta
                      now={pulsa.hariIni.omzet}
                      before={tren[6].omzet}
                      label="vs minggu lalu"
                      onInk
                    />
                  )}
                </div>
                <div className="mt-auto grid grid-cols-2 gap-3">
                  <div className="rounded-2xl bg-white/5 p-3">
                    <p className="text-xs text-on-ink-muted">Pesanan</p>
                    <p className="mt-1 text-2xl font-bold tabular-nums">
                      {pulsa.hariIni.pesanan}
                    </p>
                  </div>
                  <div className="rounded-2xl bg-white/5 p-3">
                    <p className="text-xs text-on-ink-muted">
                      Rata-rata / pesanan
                    </p>
                    <p className="mt-1 text-2xl font-bold tabular-nums">
                      {formatRupiahCompact(pulsa.hariIni.rataRata)}
                    </p>
                  </div>
                </div>
                {target.harianRp > 0 && (
                  <TargetBar
                    value={pulsa.hariIni.omzet}
                    target={target.harianRp}
                    label="Target harian"
                    onInk
                  />
                )}
              </div>
            )
          )}
        </Card>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-1">
          {keputusan && keputusan.total > 0 ? (
            <Card variant="accent" className="p-5 py-5">
              <p className="text-[13px] font-semibold text-accent-foreground/75">
                Menunggu keputusan
              </p>
              <p className="mt-2 text-5xl leading-none font-bold tracking-tight tabular-nums">
                {keputusan.total}
              </p>
              <p className="mt-2 text-sm text-accent-foreground/75">
                pengajuan dan dokumen menunggu persetujuan
              </p>
            </Card>
          ) : (
            <StatCard
              label="Menunggu keputusan"
              value={keputusan?.total ?? "–"}
              hint="pengajuan dan dokumen"
              icon={<Inbox />}
              tone="success"
            />
          )}
          {failed.has("overview:timHariIni") ? (
            <FailedNote />
          ) : (
            tim && (
              <StatCard
                label="Tim hari ini"
                value={tim.hadir}
                unit={`/ ${tim.aktif} hadir`}
                hint={`${tim.terlambat} telat · ${tim.belum} belum absen · ${tim.cuti} cuti`}
                icon={<Users />}
                tone={tim.terlambat > 0 ? "warning" : "default"}
                href="/dashboard/hris/attendance"
              />
            )
          )}
        </div>
      </div>

      {data.gym && <GymTodayCard gym={data.gym} />}

      {/* Tren 14 hari: hari ini satu-satunya aksen */}
      <SectionCard
        title="Tren penjualan 14 hari"
        href="/dashboard/pos"
        failed={failed.has("tren14")}
      >
        {tren && (
          <>
            <div
              role="img"
              aria-label={`Omzet 14 hari terakhir, hari ini ${formatRupiahCompact(tren[tren.length - 1]?.omzet ?? 0)}`}
              className="flex h-40 items-end gap-1.5"
            >
              {tren.map((p, i) => (
                <div key={p.tanggal} className="flex h-full flex-1 items-end">
                  <div
                    title={`${p.tanggal}: ${formatRupiahCompact(p.omzet)} · ${p.pesanan} pesanan`}
                    style={{
                      height: `${Math.max(3, (p.omzet / maxOmzet) * 100)}%`,
                    }}
                    className={cn(
                      "w-full rounded-full transition-colors",
                      i === tren.length - 1
                        ? "bg-forest"
                        : i >= 7
                          ? "bg-silver hover:bg-muted-foreground"
                          : "bg-chart-muted hover:bg-silver",
                    )}
                  />
                </div>
              ))}
            </div>
            <div className="mt-2 flex gap-1.5">
              {tren.map((p, i) => (
                <span
                  key={p.tanggal}
                  className={cn(
                    "flex-1 text-center text-[10px]",
                    i === tren.length - 1
                      ? "font-semibold text-foreground"
                      : "text-muted-foreground",
                  )}
                >
                  {DAY_SHORT[new Date(`${p.tanggal}T00:00:00`).getDay()]}
                </span>
              ))}
            </div>
            {minggu && (
              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-4 text-sm text-body">
                Minggu berjalan{" "}
                <strong className="text-foreground tabular-nums">
                  {formatRupiahCompact(minggu.ini)}
                </strong>
                <Delta
                  now={minggu.ini}
                  before={minggu.lalu}
                  label="vs 7 hari sebelumnya"
                />
              </div>
            )}
          </>
        )}
      </SectionCard>

      {/* Bulan berjalan & outlet */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <SectionCard
          title="Bulan berjalan"
          href="/dashboard/pos"
          failed={failed.has("bulanBerjalan")}
        >
          {data.bulanBerjalan && (
            <div className="space-y-4">
              <div className="flex items-end gap-2">
                <span className="text-3xl font-bold tracking-tight text-foreground tabular-nums">
                  {formatRupiahCompact(data.bulanBerjalan.omzet)}
                </span>
                <span className="pb-0.5 text-sm font-semibold text-muted-foreground">
                  {data.bulanBerjalan.pesanan} pesanan
                </span>
              </div>
              {target.bulananRp > 0 ? (
                <TargetBar
                  value={data.bulanBerjalan.omzet}
                  target={target.bulananRp}
                  label="Target bulanan"
                />
              ) : (
                <p className="text-xs text-muted-foreground">
                  Target bulanan belum diatur.
                </p>
              )}
              <TargetEditor
                target={target}
                onSaved={(next) => setTarget(next)}
              />
            </div>
          )}
        </SectionCard>

        <SectionCard
          title="Per outlet · 7 hari"
          href="/dashboard/pos"
          failed={failed.has("outlet")}
        >
          {data.omzetPerOutlet &&
            (data.omzetPerOutlet.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Belum ada penjualan 7 hari terakhir.
              </p>
            ) : (
              <ul className="space-y-3">
                {data.omzetPerOutlet.map((row, i) => {
                  const max = data.omzetPerOutlet![0]?.omzet7Hari || 1;
                  return (
                    <li key={row.outlet} className="text-sm">
                      <div className="flex items-center gap-3">
                        <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                          {row.outlet}
                        </span>
                        <span className="shrink-0 font-semibold text-foreground tabular-nums">
                          {formatRupiahCompact(row.omzet7Hari)}
                        </span>
                      </div>
                      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface">
                        <i
                          style={{ width: `${(row.omzet7Hari / max) * 100}%` }}
                          className={cn(
                            "block h-full rounded-full",
                            i === 0 ? "bg-forest" : "bg-chart-muted",
                          )}
                        />
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Hari ini {formatRupiahCompact(row.omzetHariIni)} ·{" "}
                        {row.pesananHariIni} pesanan
                      </p>
                    </li>
                  );
                })}
              </ul>
            ))}
        </SectionCard>
      </div>

      <ExecutiveModuleSections data={data} failed={failed} />
    </div>
  );
}
