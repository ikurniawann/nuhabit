"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  Banknote,
  CalendarClock,
  ClipboardCheck,
  Dumbbell,
  Inbox,
  Package,
  ReceiptText,
  ScanLine,
  Truck,
  UserPlus,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { IconTile, StatCard } from "@/components/ui/stat-card";
import { cn } from "@/lib/utils";
import type { ExecutiveDashboard } from "@/lib/dashboard/executive";
import type { SalesTargetConfig } from "@/lib/dashboard/sales-target";

/**
 * Dashboard eksekutif /dashboard (EPIC-021) — super_admin + direksi.
 * High-level & taktis lintas modul: setiap angka berpembanding dan ber-deep-link,
 * analisis dalam tetap di dashboard modul masing-masing.
 * Halaman referensi gaya WIT (docs/frontend-conventions.md).
 */

const REFRESH_MS = 60_000;

function formatRupiah(value: number): string {
  if (Math.abs(value) >= 1_000_000_000)
    return `Rp ${(value / 1_000_000_000).toLocaleString("id-ID", { maximumFractionDigits: 2 })} M`;
  if (Math.abs(value) >= 1_000_000)
    return `Rp ${(value / 1_000_000).toLocaleString("id-ID", { maximumFractionDigits: 2 })} jt`;
  if (Math.abs(value) >= 1_000)
    return `Rp ${(value / 1_000).toLocaleString("id-ID", { maximumFractionDigits: 0 })} rb`;
  return `Rp ${value.toLocaleString("id-ID", { maximumFractionDigits: 0 })}`;
}

/** Change against a baseline; `onInk` renders it for the ink hero. */
function Delta({
  now,
  before,
  label,
  onInk = false,
}: {
  now: number;
  before: number;
  label: string;
  onInk?: boolean;
}) {
  if (before <= 0) {
    return (
      <span className={cn("text-xs", onInk ? "text-on-ink-muted" : "text-muted-foreground")}>
        {label}: belum ada pembanding
      </span>
    );
  }
  const pct = Math.round(((now - before) / before) * 100);
  const up = pct >= 0;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold tabular-nums",
        onInk
          ? "bg-white/10 text-white"
          : up
            ? "bg-success-soft text-success"
            : "bg-danger-soft text-danger"
      )}
    >
      {up ? "▲" : "▼"} {Math.abs(pct)}%{" "}
      <span className={cn("font-normal", onInk ? "text-on-ink-muted" : "text-muted-foreground")}>
        {label}
      </span>
    </span>
  );
}

function OpenLink({ href, label = "Buka" }: { href: string; label?: string }) {
  return (
    <Link
      href={href}
      className="inline-flex h-8 items-center gap-1 rounded-full px-3 text-xs font-semibold text-foreground transition-colors hover:bg-black/5 focus-visible:ring-2 focus-visible:ring-forest/40 focus-visible:outline-none"
    >
      {label}
      <ArrowUpRight className="size-3.5" />
    </Link>
  );
}

function SectionCard({
  title,
  href,
  hrefLabel,
  children,
  failed,
}: {
  title: string;
  href?: string;
  hrefLabel?: string;
  children: React.ReactNode;
  failed?: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{title}</h2>
        </CardTitle>
        {href && (
          <CardAction>
            <OpenLink href={href} label={hrefLabel} />
          </CardAction>
        )}
      </CardHeader>
      <CardContent>
        {failed ? <FailedNote /> : children}
      </CardContent>
    </Card>
  );
}

function FailedNote() {
  return (
    <p className="rounded-2xl bg-danger-soft px-3 py-2 text-xs text-danger">
      Data tidak terjangkau. Halaman memuat ulang otomatis tiap 60 detik.
    </p>
  );
}

function TargetBar({ value, target, label, onInk = false }: { value: number; target: number; label: string; onInk?: boolean }) {
  const pct = Math.round((value / target) * 100);
  return (
    <div>
      <div className={cn("mb-1.5 flex justify-between text-[11px]", onInk ? "text-on-ink-muted" : "text-muted-foreground")}>
        <span>
          {label} {formatRupiah(target)}
        </span>
        <span className={cn("font-semibold tabular-nums", onInk ? "text-white" : "text-foreground")}>{pct}%</span>
      </div>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.min(100, pct)}
        aria-valuetext={`${pct}% dari ${label.toLowerCase()}`}
        className={cn("h-1.5 overflow-hidden rounded-full", onInk ? "bg-white/15" : "bg-surface")}
      >
        <i
          style={{ width: `${Math.min(100, pct)}%` }}
          className={cn("block h-full rounded-full", onInk ? "bg-accent" : "bg-forest")}
        />
      </div>
    </div>
  );
}

const DAY_SHORT = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];

export function ExecutiveDashboardPage() {
  const [data, setData] = useState<ExecutiveDashboard | null>(null);
  const [target, setTarget] = useState<SalesTargetConfig>({ harianRp: 0, bulananRp: 0 });
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/dashboard/executive");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Gagal memuat");
      setData(json.data as ExecutiveDashboard);
      if (json.target) setTarget(json.target as SalesTargetConfig);
      setError(null);
    } catch (e) {
      setError((prev) => (data ? prev : e instanceof Error ? e.message : "Gagal memuat"));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  if (error && !data) {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-card bg-card p-5 shadow-card">
        <IconTile tone="danger">
          <Inbox />
        </IconTile>
        <div className="min-w-[12rem] flex-1">
          <p className="text-sm font-semibold text-foreground">Ringkasan belum bisa dimuat</p>
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
              <div key={i} className="h-28 animate-pulse rounded-card bg-card" />
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
  const minggu = tren
    ? {
        ini: tren.slice(7).reduce((a, p) => a + p.omzet, 0),
        lalu: tren.slice(0, 7).reduce((a, p) => a + p.omzet, 0),
      }
    : null;
  const maxOmzet = tren ? Math.max(...tren.map((p) => p.omzet), 1) : 1;

  const antrean = keputusan
    ? [
        { t: "Pengajuan cuti", n: keputusan.cuti, href: "/dashboard/hris/leaves", icon: <CalendarClock /> },
        { t: "Pengajuan lembur", n: keputusan.lembur, href: "/dashboard/hris/overtime", icon: <ClipboardCheck /> },
        { t: "Pengajuan pinjaman", n: keputusan.pinjaman, href: "/dashboard/hris/loans", icon: <Banknote /> },
        { t: "PO draft", n: keputusan.poDraft, href: "/dashboard/purchasing/approval", icon: <ReceiptText /> },
        { t: "Kandidat baru", n: keputusan.kandidatBaru, href: "/dashboard/hris/candidates", icon: <UserPlus /> },
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
            Diperbarui{" "}
            {new Date(data.dibuatPada).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}{" "}
            · otomatis tiap 60 detik
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
                        <span className="mt-1 block truncate text-xs text-muted-foreground">{r.t}</span>
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
                      {formatRupiah(pulsa.hariIni.omzet)}
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
                  <Delta now={pulsa.hariIni.omzet} before={pulsa.kemarin.omzet} label="vs kemarin" onInk />
                  {tren && tren.length === 14 && (
                    <Delta now={pulsa.hariIni.omzet} before={tren[6].omzet} label="vs minggu lalu" onInk />
                  )}
                </div>
                <div className="mt-auto grid grid-cols-2 gap-3">
                  <div className="rounded-2xl bg-white/5 p-3">
                    <p className="text-xs text-on-ink-muted">Pesanan</p>
                    <p className="mt-1 text-2xl font-bold tabular-nums">{pulsa.hariIni.pesanan}</p>
                  </div>
                  <div className="rounded-2xl bg-white/5 p-3">
                    <p className="text-xs text-on-ink-muted">Rata-rata / pesanan</p>
                    <p className="mt-1 text-2xl font-bold tabular-nums">{formatRupiah(pulsa.hariIni.rataRata)}</p>
                  </div>
                </div>
                {target.harianRp > 0 && (
                  <TargetBar value={pulsa.hariIni.omzet} target={target.harianRp} label="Target harian" onInk />
                )}
              </div>
            )
          )}
        </Card>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-1">
          {keputusan && keputusan.total > 0 ? (
            <Card variant="accent" className="p-5 py-5">
              <p className="text-[13px] font-semibold text-accent-foreground/75">Menunggu keputusan</p>
              <p className="mt-2 text-5xl leading-none font-bold tracking-tight tabular-nums">{keputusan.total}</p>
              <p className="mt-2 text-sm text-accent-foreground/75">pengajuan dan dokumen menunggu persetujuan</p>
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
      <SectionCard title="Tren penjualan 14 hari" href="/dashboard/pos" failed={failed.has("tren14")}>
        {tren && (
          <>
            <div
              role="img"
              aria-label={`Omzet 14 hari terakhir, hari ini ${formatRupiah(tren[tren.length - 1]?.omzet ?? 0)}`}
              className="flex h-40 items-end gap-1.5"
            >
              {tren.map((p, i) => (
                <div key={p.tanggal} className="flex h-full flex-1 items-end">
                  <div
                    title={`${p.tanggal}: ${formatRupiah(p.omzet)} · ${p.pesanan} pesanan`}
                    style={{ height: `${Math.max(3, (p.omzet / maxOmzet) * 100)}%` }}
                    className={cn(
                      "w-full rounded-full transition-colors",
                      i === tren.length - 1 ? "bg-forest" : i >= 7 ? "bg-silver hover:bg-muted-foreground" : "bg-chart-muted hover:bg-silver"
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
                    i === tren.length - 1 ? "font-semibold text-foreground" : "text-muted-foreground"
                  )}
                >
                  {DAY_SHORT[new Date(`${p.tanggal}T00:00:00`).getDay()]}
                </span>
              ))}
            </div>
            {minggu && (
              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-4 text-sm text-body">
                Minggu berjalan <strong className="text-foreground tabular-nums">{formatRupiah(minggu.ini)}</strong>
                <Delta now={minggu.ini} before={minggu.lalu} label="vs 7 hari sebelumnya" />
              </div>
            )}
          </>
        )}
      </SectionCard>

      {/* Bulan berjalan & outlet */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <SectionCard title="Bulan berjalan" href="/dashboard/pos" failed={failed.has("bulanBerjalan")}>
          {data.bulanBerjalan && (
            <div className="space-y-4">
              <div className="flex items-end gap-2">
                <span className="text-3xl font-bold tracking-tight text-foreground tabular-nums">
                  {formatRupiah(data.bulanBerjalan.omzet)}
                </span>
                <span className="pb-0.5 text-sm font-semibold text-muted-foreground">
                  {data.bulanBerjalan.pesanan} pesanan
                </span>
              </div>
              {target.bulananRp > 0 ? (
                <TargetBar value={data.bulanBerjalan.omzet} target={target.bulananRp} label="Target bulanan" />
              ) : (
                <p className="text-xs text-muted-foreground">Target bulanan belum diatur.</p>
              )}
              <TargetEditor target={target} onSaved={(next) => setTarget(next)} />
            </div>
          )}
        </SectionCard>

        <SectionCard title="Per outlet · 7 hari" href="/dashboard/pos" failed={failed.has("outlet")}>
          {data.omzetPerOutlet &&
            (data.omzetPerOutlet.length === 0 ? (
              <p className="text-sm text-muted-foreground">Belum ada penjualan 7 hari terakhir.</p>
            ) : (
              <ul className="space-y-3">
                {data.omzetPerOutlet.map((row, i) => {
                  const max = data.omzetPerOutlet![0]?.omzet7Hari || 1;
                  return (
                    <li key={row.outlet} className="text-sm">
                      <div className="flex items-center gap-3">
                        <span className="min-w-0 flex-1 truncate font-medium text-foreground">{row.outlet}</span>
                        <span className="shrink-0 font-semibold text-foreground tabular-nums">
                          {formatRupiah(row.omzet7Hari)}
                        </span>
                      </div>
                      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface">
                        <i
                          style={{ width: `${(row.omzet7Hari / max) * 100}%` }}
                          className={cn("block h-full rounded-full", i === 0 ? "bg-forest" : "bg-chart-muted")}
                        />
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Hari ini {formatRupiah(row.omzetHariIni)} · {row.pesananHariIni} pesanan
                      </p>
                    </li>
                  );
                })}
              </ul>
            ))}
        </SectionCard>
      </div>

      {/* Produk · Stok · Purchasing */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <SectionCard title="Produk terlaris · 7 hari" href="/dashboard/pos" failed={failed.has("topProduk")}>
          {data.topProduk7Hari &&
            (data.topProduk7Hari.length === 0 ? (
              <p className="text-sm text-muted-foreground">Belum ada penjualan 7 hari terakhir.</p>
            ) : (
              <ol className="space-y-2.5">
                {data.topProduk7Hari.map((p, i) => (
                  <li key={p.produk} className="flex items-center gap-3 text-sm">
                    <span
                      className={cn(
                        "flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold tabular-nums",
                        i === 0 ? "bg-ink text-on-ink" : "bg-surface text-body"
                      )}
                    >
                      {i + 1}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-foreground">{p.produk}</span>
                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{p.qty}×</span>
                    <span className="shrink-0 font-semibold text-foreground tabular-nums">{formatRupiah(p.omzet)}</span>
                  </li>
                ))}
              </ol>
            ))}
        </SectionCard>

        <SectionCard
          title="Inventori"
          href="/dashboard/inventory/low-stock"
          hrefLabel="Stok menipis"
          failed={failed.has("nilaiPersediaan") && failed.has("overview:stokMenipis")}
        >
          <div className="space-y-3">
            {data.nilaiPersediaan !== null && (
              <div className="flex items-start gap-3">
                <IconTile tone="default">
                  <Package />
                </IconTile>
                <div>
                  <p className="text-xs text-muted-foreground">Nilai persediaan saat ini</p>
                  <p className="text-2xl font-bold tracking-tight text-foreground tabular-nums">
                    {formatRupiah(data.nilaiPersediaan)}
                  </p>
                </div>
              </div>
            )}
            {o.stokMenipis && (
              <p
                className={cn(
                  "rounded-2xl px-3 py-2.5 text-sm",
                  o.stokMenipis.jumlah > 0 ? "bg-warning-soft text-warning" : "bg-success-soft text-success"
                )}
              >
                {o.stokMenipis.jumlah > 0
                  ? `${o.stokMenipis.jumlah} bahan di bawah minimum`
                  : "Semua stok di atas batas minimum"}
              </p>
            )}
          </div>
        </SectionCard>

        <SectionCard title="Purchasing bulan ini" href="/dashboard/purchasing" failed={failed.has("purchasing")}>
          {data.purchasingBulanIni && (
            <div className="space-y-3">
              <div className="flex items-start gap-3">
                <IconTile tone="info">
                  <Truck />
                </IconTile>
                <div>
                  <p className="text-2xl font-bold tracking-tight text-foreground tabular-nums">
                    {data.purchasingBulanIni.jumlahPo} <span className="text-sm font-semibold text-muted-foreground">PO</span>
                  </p>
                  <p className="text-xs text-muted-foreground">{formatRupiah(data.purchasingBulanIni.nilaiTotal)}</p>
                </div>
              </div>
              {data.purchasingBulanIni.perStatus.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {data.purchasingBulanIni.perStatus.map((s) => (
                    <span key={s.status} className="rounded-full bg-surface px-2.5 py-0.5 text-xs text-body">
                      {s.status} <strong className="tabular-nums">{s.jumlah}</strong>
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </SectionCard>
      </div>

      {/* Payroll & SDM · Member */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <SectionCard title="Payroll & SDM" href="/dashboard/hris/payroll" failed={failed.has("payroll")}>
          <div className="space-y-3 text-sm">
            {data.payrollTerakhir ? (
              <div>
                <p className="text-xs text-muted-foreground">Run terakhir · {data.payrollTerakhir.periode}</p>
                <p className="mt-1 flex flex-wrap items-center gap-2 text-2xl font-bold tracking-tight text-foreground tabular-nums">
                  {formatRupiah(data.payrollTerakhir.totalNet)}
                  <span className="rounded-full bg-surface px-2.5 py-0.5 text-xs font-medium tracking-normal text-body">
                    {data.payrollTerakhir.status}
                  </span>
                </p>
              </div>
            ) : (
              <p className="text-muted-foreground">Belum ada payroll run. Jalankan payroll dari menu HRIS.</p>
            )}
            {data.kontrakHabis30Hari !== null && (
              <Link
                href="/dashboard/hris/contracts"
                className={cn(
                  "block rounded-2xl px-3 py-2.5 text-sm transition-colors",
                  data.kontrakHabis30Hari > 0
                    ? "bg-warning-soft text-warning hover:bg-warning-soft/70"
                    : "bg-surface-2 text-muted-foreground hover:bg-surface"
                )}
              >
                {data.kontrakHabis30Hari > 0
                  ? `${data.kontrakHabis30Hari} kontrak berakhir dalam 30 hari`
                  : "Tidak ada kontrak berakhir dalam 30 hari"}
              </Link>
            )}
          </div>
        </SectionCard>

        <SectionCard title="Member & loyalty · 7 hari" href="/dashboard/crm/members" failed={failed.has("overview:member")}>
          {o.member && (
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  { label: "Member baru", value: o.member.memberBaru7Hari },
                  { label: "XP keluar", value: o.member.xpTerdistribusi7Hari },
                  { label: "Reward ditukar", value: o.member.rewardDitukar7Hari },
                ] as const
              ).map((m) => (
                <div key={m.label} className="rounded-2xl bg-surface-2 p-3">
                  <p className="text-xl font-bold text-foreground tabular-nums">{m.value.toLocaleString("id-ID")}</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">{m.label}</p>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  );
}

function GymTodayCard({ gym }: { gym: NonNullable<ExecutiveDashboard["gym"]> }) {
  return (
    <SectionCard title="Gym hari ini" href="/dashboard/gym/schedule" hrefLabel="Jadwal">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Kelas" value={gym.kelasHariIni} hint={`${gym.waitlistHariIni} di waitlist`} icon={<Dumbbell />} />
        <StatCard
          label="Kursi terisi"
          value={`${gym.isiKelasPersen}%`}
          hint={`${gym.bookingHariIni} booking`}
          icon={<Users />}
          tone={gym.isiKelasPersen >= 80 ? "accent" : "default"}
        />
        <StatCard label="Check-in" value={gym.checkinHariIni} hint="member masuk kelas" icon={<ScanLine />} href="/dashboard/gym/checkin" />
        <StatCard
          label="Paket terjual · 30 hari"
          value={gym.paketTerjual30Hari}
          hint={`${formatRupiah(gym.pendapatanPaket30Hari)} · ${gym.kreditBeredar} kredit beredar`}
          icon={<ReceiptText />}
          href="/dashboard/gym/credits"
        />
      </div>
      {gym.sesi.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">Belum ada kelas terjadwal hari ini.</p>
      ) : (
        <ul className="mt-4 divide-y divide-border">
          {gym.sesi.map((s) => {
            const pct = s.kapasitas > 0 ? Math.min(100, Math.round((s.terisi / s.kapasitas) * 100)) : 0;
            return (
              <li key={s.id}>
                <Link
                  href={`/dashboard/gym/sessions/${s.id}`}
                  className="grid grid-cols-[3.5rem_minmax(0,1fr)_auto] items-center gap-3 rounded-xl py-2.5 transition-colors hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-forest/40 focus-visible:outline-none"
                >
                  <span className="font-display text-sm font-semibold tabular-nums">
                    {new Date(s.mulai).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" })}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">{s.kelas}</span>
                    <span className="block truncate text-xs text-muted-foreground">{s.coach ?? "Belum ada coach"}</span>
                  </span>
                  <span className="w-28 text-right">
                    <span className="text-xs font-semibold tabular-nums">
                      {s.terisi}/{s.kapasitas}
                      {s.waitlist > 0 && <span className="text-muted-foreground"> +{s.waitlist}</span>}
                    </span>
                    <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-surface">
                      <span className={cn("block h-full rounded-full", pct >= 100 ? "bg-forest" : "bg-accent")} style={{ width: `${pct}%` }} />
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
}

function TargetEditor({
  target,
  onSaved,
}: {
  target: SalesTargetConfig;
  onSaved: (next: SalesTargetConfig) => void;
}) {
  const [open, setOpen] = useState(false);
  const [harian, setHarian] = useState("");
  const [bulanan, setBulanan] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!open) {
    return (
      <Button
        variant="soft"
        size="sm"
        onClick={() => {
          setHarian(target.harianRp ? String(target.harianRp) : "");
          setBulanan(target.bulananRp ? String(target.bulananRp) : "");
          setOpen(true);
        }}
      >
        Atur target
      </Button>
    );
  }

  const save = async () => {
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch("/api/settings/sales-target", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ harianRp: harian || 0, bulananRp: bulanan || 0 }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Gagal menyimpan");
      onSaved(json.data.config as SalesTargetConfig);
      setOpen(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Gagal menyimpan");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3 rounded-2xl bg-surface-2 p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="text-sm font-medium text-foreground">
          Target harian (Rp)
          <Input
            value={harian}
            onChange={(e) => setHarian(e.target.value)}
            inputMode="numeric"
            placeholder="mis. 5000000"
            className="mt-1.5"
          />
        </label>
        <label className="text-sm font-medium text-foreground">
          Target bulanan (Rp)
          <Input
            value={bulanan}
            onChange={(e) => setBulanan(e.target.value)}
            inputMode="numeric"
            placeholder="mis. 120000000"
            className="mt-1.5"
          />
        </label>
      </div>
      {err && <p className="text-xs text-danger">{err}</p>}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={save} disabled={saving}>
          {saving ? "Menyimpan…" : "Simpan target"}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Batal
        </Button>
      </div>
    </div>
  );
}
