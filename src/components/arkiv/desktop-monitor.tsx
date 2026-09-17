"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useRouter } from "next/navigation";
import type { DesktopOverview } from "@/lib/desktop/overview";
import type { ActivityNotification } from "@/lib/desktop/notifications";
import { buildAskDoPrompt } from "@/lib/desktop/ask-do";
import { PERIOD_KINDS, PERIOD_LABELS, type PeriodKind } from "@/lib/desktop/period";

/**
 * Papan widget monitoring owner di desktop BCD Coffee OS (EPIC-019 Fase B).
 *
 * Revisi owner 2026-07-21: tanpa ikon sama sekali, dan permukaan kartu
 * disamakan dengan Calendar Widget (bg-slate-950/55 — lebih gelap daripada
 * glass putih sebelumnya).
 */

const REFRESH_MS = 60_000; // keputusan owner: 60 detik

/** Permukaan kartu — identik dengan WindowShell/Calendar Widget. */
const CARD = "rounded-3xl border border-white/18 bg-slate-950/55 shadow-2xl backdrop-blur-2xl";

// Daftar widget kini tinggal di @/lib/desktop/widgets supaya kode server
// bisa memakainya tanpa menarik komponen klien ini. Re-export agar pemakai
// lama (import dari desktop-monitor) tetap jalan.
import {
  MONITOR_WIDGETS,
  normalizeWidgetOrder,
  type MonitorWidgetKey,
} from "@/lib/desktop/widgets";

export { MONITOR_WIDGETS, normalizeWidgetOrder, type MonitorWidgetKey };

export interface OverviewState {
  status: "loading" | "ready" | "forbidden" | "error";
  data: DesktopOverview | null;
}

const PERIOD_STORAGE_KEY = "arkiv-desktop-period";

/** Pendengar lokal: `storage` hanya menyala di TAB LAIN, tab sendiri perlu ini. */
const periodListeners = new Set<() => void>();

function subscribePeriod(callback: () => void): () => void {
  periodListeners.add(callback);
  window.addEventListener("storage", callback);
  return () => {
    periodListeners.delete(callback);
    window.removeEventListener("storage", callback);
  };
}

function readPeriod(): PeriodKind {
  try {
    const saved = window.localStorage.getItem(PERIOD_STORAGE_KEY);
    return (PERIOD_KINDS as readonly string[]).includes(saved ?? "")
      ? (saved as PeriodKind)
      : "today";
  } catch {
    return "today"; // mode privat / storage diblokir
  }
}

/**
 * Pilihan periode papan, bertahan antar sesi (EPIC-037 Fase A).
 *
 * Memakai `useSyncExternalStore`, bukan useEffect + setState: snapshot server
 * dikunci ke `today` sehingga tidak ada hydration mismatch, dan tidak ada
 * render berantai. Efek sampingnya berguna — membuka papan di dua tab membuat
 * pilihan periodenya ikut serempak lewat event `storage`.
 */
export function usePeriodPreference(): [PeriodKind, (next: PeriodKind) => void] {
  const periode = useSyncExternalStore<PeriodKind>(
    subscribePeriod,
    readPeriod,
    () => "today"
  );

  const pilih = useCallback((next: PeriodKind) => {
    try {
      window.localStorage.setItem(PERIOD_STORAGE_KEY, next);
    } catch {
      // Mode privat/kuota penuh: preferensi tidak tersimpan, papan tetap jalan.
    }
    periodListeners.forEach((notify) => notify());
  }, []);

  return [periode, pilih];
}

function formatTanggalPendek(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const bulan = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Ags", "Sep", "Okt", "Nov", "Des"];
  return `${d} ${bulan[m - 1]} ${String(y).slice(2)}`;
}

/**
 * Switcher periode di level papan — satu kontrol untuk semua widget, bukan
 * tombol per kartu. Baris ringkasannya menunjukkan jendela pembanding yang
 * dipakai, karena "naik 12%" tanpa keterangan dibanding apa tidak bisa
 * ditindaklanjuti.
 */
function PeriodSwitcher({
  periode,
  onPilih,
  state,
}: {
  periode: PeriodKind;
  onPilih: (next: PeriodKind) => void;
  state: OverviewState;
}) {
  const meta = state.data?.periode;

  return (
    <div className={`${CARD} col-span-full p-3`}>
      <div className="flex flex-wrap gap-1">
        {PERIOD_KINDS.map((kind) => {
          const aktif = kind === periode;
          return (
            <button
              key={kind}
              type="button"
              onClick={() => onPilih(kind)}
              aria-pressed={aktif}
              className={`rounded-full px-3 py-1.5 text-[11px] font-bold transition ${
                aktif
                  ? "bg-white text-slate-950"
                  : "border border-white/18 text-white/70 hover:text-white"
              }`}
            >
              {PERIOD_LABELS[kind]}
            </button>
          );
        })}
      </div>

      {meta && (
        <div className="mt-2.5 text-[10px] leading-relaxed text-white/40">
          {formatTanggalPendek(meta.periode.mulai)}–
          {formatTanggalPendek(meta.periode.selesai)} · dibanding{" "}
          {formatTanggalPendek(meta.banding.mulai)}–
          {formatTanggalPendek(meta.banding.selesai)}
          {/* Jendela pembanding lebih pendek (mis. 31 Mar vs Feb) — harus
              dikatakan, bukan disembunyikan di balik satu angka persen. */}
          {!meta.banding.penuh && (
            <span className="text-amber-300/80">
              {" "}
              · pembanding hanya {meta.banding.hariBanding} hari, periode ini{" "}
              {meta.periode.hariBerjalan} hari
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Fetch + auto-refresh 60 dtk (berhenti saat tab tersembunyi). 401/403 →
 * `forbidden`, papan tidak dirender dan polling berhenti total.
 */
export function useDesktopOverview(
  enabled: boolean,
  periode: PeriodKind = "today"
): OverviewState {
  const [state, setState] = useState<OverviewState>({ status: "loading", data: null });
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/desktop/overview?periode=${periode}`);
      if (res.status === 401 || res.status === 403) {
        setState({ status: "forbidden", data: null });
        return false;
      }
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "gagal");
      setState({ status: "ready", data: json.data as DesktopOverview });
      return true;
    } catch {
      setState((prev) => (prev.data ? prev : { status: "error", data: null }));
      return true; // error jaringan sementara: coba lagi di poll berikutnya
    }
  }, [periode]);

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;

    const tick = async () => {
      if (document.visibilityState === "hidden") return;
      const keepPolling = await load();
      if (!keepPolling && timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };

    tick();
    timerRef.current = setInterval(tick, REFRESH_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible" && !stopped) tick();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      stopped = true;
      if (timerRef.current) clearInterval(timerRef.current);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, load]);

  return state;
}

/* ── format ───────────────────────────────────────────── */

function formatRupiah(value: number): string {
  if (value >= 1_000_000_000) return `Rp ${(value / 1_000_000_000).toLocaleString("id-ID", { maximumFractionDigits: 2 })} M`;
  if (value >= 1_000_000) return `Rp ${(value / 1_000_000).toLocaleString("id-ID", { maximumFractionDigits: 2 })} jt`;
  if (value >= 1_000) return `Rp ${(value / 1_000).toLocaleString("id-ID", { maximumFractionDigits: 0 })} rb`;
  return `Rp ${value.toLocaleString("id-ID", { maximumFractionDigits: 0 })}`;
}

function deltaPct(today: number, yesterday: number): number | null {
  if (yesterday <= 0) return null;
  return Math.round(((today - yesterday) / yesterday) * 100);
}

/** Persen kecil di samping angka pembanding (kemarin / minggu lalu). */
function MiniDelta({ today, base }: { today: number; base: number }) {
  const pct = deltaPct(today, base);
  if (pct === null) return null;
  const up = pct >= 0;
  return (
    <span className={`ml-1 text-[10px] font-bold ${up ? "text-emerald-300" : "text-rose-300"}`}>
      {up ? "▲" : "▼"}{Math.abs(pct)}%
    </span>
  );
}

const DAY_SHORT = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];

/* ── kerangka kartu (tanpa ikon) ──────────────────────── */

function Card({
  title,
  subtitle,
  href,
  onGo,
  onAskDo,
  askDoPrompt,
  children,
  failed,
  wide = false,
}: {
  title: string;
  subtitle: string;
  href: string;
  onGo: (href: string) => void;
  onAskDo?: (prompt: string) => void;
  askDoPrompt?: string;
  children: React.ReactNode;
  failed?: boolean;
  wide?: boolean;
}) {
  return (
    <article className={`${CARD} p-4 ${wide ? "col-span-full" : ""}`}>
      <div className="mb-3 flex items-start gap-2">
        <div className="min-w-0">
          <div className="text-[13px] font-bold leading-tight">{title}</div>
          <div className="truncate text-[11px] text-white/40">{subtitle}</div>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {onAskDo && askDoPrompt && (
            <button
              type="button"
              onClick={() => onAskDo(askDoPrompt)}
              className="rounded-full border border-pink-400/35 bg-pink-500/15 px-2.5 py-1 text-[11px] font-semibold text-pink-100 transition hover:bg-pink-500/28"
            >
              Tanya Do
            </button>
          )}
          <button
            type="button"
            onClick={() => onGo(href)}
            className="rounded-full border border-white/14 bg-white/8 px-2.5 py-1 text-[11px] font-semibold text-white/55 transition hover:bg-white/16 hover:text-white"
          >
            Buka ›
          </button>
        </div>
      </div>
      {failed ? (
        <div className="rounded-2xl bg-rose-500/10 px-3 py-2.5 text-xs text-rose-200">
          Data tak terjangkau — dicoba lagi otomatis.
        </div>
      ) : (
        children
      )}
    </article>
  );
}

function Skeleton({ wide = false }: { wide?: boolean }) {
  return (
    <div className={`${CARD} p-4 ${wide ? "col-span-full" : ""}`}>
      <div className="h-3.5 w-1/2 animate-pulse rounded-md bg-white/15" />
      <div className="mt-3 h-8 w-2/3 animate-pulse rounded-md bg-white/12" />
      <div className="mt-2 h-3 w-3/4 animate-pulse rounded-md bg-white/10" />
    </div>
  );
}

/* ── popup notifikasi aktivitas ───────────────────────── */

const POPUP_DISMISS_MS = 7_000;

/**
 * Tumpukan popup di kanan atas: setiap aktivitas baru muncul sebagai kartu,
 * hilang sendiri setelah 7 detik, klik = menuju modulnya.
 */
export function NotificationPopups({
  popups,
  onDismiss,
  onOpen,
}: {
  popups: ActivityNotification[];
  onDismiss: (id: string) => void;
  onOpen: (notification: ActivityNotification) => void;
}) {
  useEffect(() => {
    if (popups.length === 0) return;
    const timers = popups.map((n) => setTimeout(() => onDismiss(n.id), POPUP_DISMISS_MS));
    return () => timers.forEach(clearTimeout);
    // Tiap popup dijadwalkan sekali saat muncul; onDismiss stabil dari parent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [popups.map((n) => n.id).join("|")]);

  if (popups.length === 0) return null;

  return (
    <div className="fixed right-5 top-12 z-[80] flex w-[min(340px,calc(100vw-32px))] flex-col gap-2">
      {popups.slice(-4).map((n) => (
        <div key={n.id} className={`${CARD} flex items-start gap-3 p-3.5`}>
          <button onClick={() => onOpen(n)} className="min-w-0 flex-1 text-left">
            <div className="text-sm leading-5 text-white/85">{n.text}</div>
            <div className="mt-1 text-[11px] text-white/35">
              {new Date(n.at).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })} · klik untuk membuka
            </div>
          </button>
          <button
            onClick={() => onDismiss(n.id)}
            aria-label="Tutup notifikasi"
            className="shrink-0 rounded-full px-1.5 text-white/40 transition hover:bg-white/10 hover:text-white"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

/* ── papan utama ──────────────────────────────────────── */

export function DesktopMonitorBoard({
  state,
  visibility,
  order,
  onAskDo,
  onOpenInbox,
  periode = "today",
  onPilihPeriode,
}: {
  state: OverviewState;
  visibility: Record<MonitorWidgetKey, boolean>;
  /** Urutan render widget pilihan user; key hilang jatuh ke urutan default. */
  order?: MonitorWidgetKey[];
  onAskDo: (prompt: string) => void;
  /** Buka panel Hari Ini berisi daftar keputusan yang bisa ditindaklanjuti. */
  onOpenInbox?: () => void;
  /** Periode papan aktif (EPIC-037 Fase A). */
  periode?: PeriodKind;
  onPilihPeriode?: (next: PeriodKind) => void;
}) {
  const router = useRouter();
  const go = useCallback((href: string) => router.push(href), [router]);

  if (state.status === "forbidden") return null;

  const anyVisible = MONITOR_WIDGETS.some((w) => visibility[w.key]);
  if (!anyVisible) return null;

  const d = state.data;
  const failedSet = new Set(d?.gagal ?? []);

  /** Kartu per widget — urutan render mengikuti preferensi user (Fase C). */
  const cardNodes: Record<MonitorWidgetKey, React.ReactNode> = {
    omzet: d && visibility.omzet && (
      <Card
        wide
        title="Pendapatan"
        subtitle={`${PERIOD_LABELS[periode]} · F&B + B2B`}
        href="/dashboard/pos"
        onGo={go}
        onAskDo={onAskDo}
        askDoPrompt={buildAskDoPrompt("omzet", d)}
        failed={failedSet.has("omzetPeriode")}
      >
        {d.omzetPeriode &&
          (d.omzetPeriode.adaData ? (
            <div>
              <div className="text-[28px] font-extrabold leading-tight tracking-tight">
                {formatRupiah(d.omzetPeriode.omzet)}
                {(() => {
                  const pct = deltaPct(d.omzetPeriode.omzet, d.omzetPeriode.banding.omzet);
                  if (pct === null) return null;
                  return (
                    <span
                      className={`ml-2 align-middle text-[11px] font-bold ${
                        pct >= 0 ? "text-emerald-300" : "text-rose-300"
                      }`}
                    >
                      {pct >= 0 ? "+" : ""}
                      {pct}%
                    </span>
                  );
                })()}
              </div>

              {/* Komposisi sumber: batang tunggal, karena yang dicari owner
                  adalah proporsi — bukan nilai absolut per sumber. */}
              <div className="mt-3 flex h-1.5 overflow-hidden rounded-full bg-white/10">
                {d.omzetPeriode.sumber.map((s) => (
                  <div
                    key={s.kunci}
                    style={{ width: `${s.porsi}%` }}
                    className={s.kunci === "fnb" ? "bg-sky-400" : "bg-violet-400"}
                  />
                ))}
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                {d.omzetPeriode.sumber.map((s) => (
                  <span key={s.kunci} className="text-[10px] text-white/50">
                    <span
                      className={`mr-1.5 inline-block h-2 w-2 rounded-full align-middle ${
                        s.kunci === "fnb" ? "bg-sky-400" : "bg-violet-400"
                      }`}
                    />
                    {s.label} {s.porsi}% · {formatRupiah(s.nilai)}
                  </span>
                ))}
              </div>

              {periode !== "today" && (
                <div className="mt-2 text-[10px] text-white/40">
                  Proyeksi akhir periode {formatRupiah(d.omzetPeriode.proyeksi)}
                </div>
              )}
            </div>
          ) : (
            /* Tegas dibedakan dari "Rp 0": belum ada transaksi tercatat sama
               sekali. Dua hal berbeda dengan tindak lanjut berbeda. */
            <div className="text-[11px] text-white/40">
              Belum ada transaksi tercatat pada periode ini.
            </div>
          ))}
      </Card>
    ),

    promo: d && visibility.promo && (
      <Card
        title="Dampak Promo"
        subtitle={PERIOD_LABELS[periode]}
        href="/dashboard/promo"
        onGo={go}
        onAskDo={onAskDo}
        askDoPrompt={buildAskDoPrompt("promo", d)}
        failed={failedSet.has("dampakPromo")}
      >
        {d.dampakPromo &&
          (d.dampakPromo.adaData ? (
            <div>
              <div className="text-[11px] text-white/40">Diskon diberikan</div>
              <div className="text-[22px] font-extrabold leading-tight tracking-tight">
                {formatRupiah(d.dampakPromo.diskon)}
              </div>
              <div className="mt-1 text-[10px] leading-relaxed text-white/50">
                membawa {formatRupiah(d.dampakPromo.omzetTerbawa)} omzet dari{" "}
                {d.dampakPromo.redemption}× pemakaian
                {d.dampakPromo.efisiensi !== null && (
                  <>
                    {" "}
                    ·{" "}
                    <span
                      className={
                        d.dampakPromo.efisiensi >= 1 ? "text-emerald-300" : "text-rose-300"
                      }
                    >
                      {d.dampakPromo.efisiensi}× lipat
                    </span>
                  </>
                )}
              </div>
              {d.dampakPromo.teratas.length > 1 && (
                <ul className="mt-2 space-y-1 border-t border-white/10 pt-2">
                  {d.dampakPromo.teratas.slice(0, 3).map((k) => (
                    <li key={k.kampanye} className="flex justify-between text-[10px] text-white/50">
                      <span className="truncate pr-2">{k.kampanye}</span>
                      <span className="shrink-0">{formatRupiah(k.diskon)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <div className="text-[11px] text-white/40">
              Belum ada promo dipakai pada periode ini.
            </div>
          ))}
      </Card>
    ),

    tamu: d && visibility.tamu && (
      <Card
        title="Tamu di Meja"
        subtitle="Sedang duduk saat ini"
        href="/dashboard/pos/restaurant"
        onGo={go}
        onAskDo={onAskDo}
        askDoPrompt={buildAskDoPrompt("tamu", d)}
        failed={failedSet.has("tamuDiMeja")}
      >
        {d.tamuDiMeja && (
          <div>
            <div className="text-[28px] font-extrabold leading-tight tracking-tight">
              {d.tamuDiMeja.tamu}
              <span className="ml-1.5 align-middle text-[11px] font-bold text-white/40">
                tamu
              </span>
            </div>
            <div className="mt-1 text-[10px] leading-relaxed text-white/50">
              {d.tamuDiMeja.meja === 0 ? (
                "Belum ada meja terisi"
              ) : (
                <>
                  di {d.tamuDiMeja.meja} meja
                  {d.tamuDiMeja.kapasitas > 0 && (
                    <> · kapasitas terpakai {d.tamuDiMeja.kapasitas} kursi</>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </Card>
    ),

    pulsa: d && visibility.pulsa && (
        <Card
          wide
          title="Ringkasan Transaksi"
          subtitle="POS · hari ini vs kemarin"
          href="/dashboard/pos"
          onGo={go}
          onAskDo={onAskDo}
          askDoPrompt={buildAskDoPrompt("pulsa", d)}
          failed={failedSet.has("pulsaBisnis")}
        >
          {d.pulsaBisnis && (
            <div className="grid grid-cols-1 items-end gap-4 min-[430px]:grid-cols-[1.2fr_1fr]">
              <div>
                <div className="text-[11px] text-white/40">Omzet hari ini</div>
                <div className="text-[28px] font-extrabold leading-tight tracking-tight">
                  {formatRupiah(d.pulsaBisnis.hariIni.omzet)}
                  {(() => {
                    const pct = deltaPct(d.pulsaBisnis.hariIni.omzet, d.pulsaBisnis.kemarin.omzet);
                    if (pct === null) return null;
                    const up = pct >= 0;
                    return (
                      <span
                        className={`ml-2 inline-flex -translate-y-1 items-center rounded-full border px-2 py-0.5 align-middle text-[11px] font-bold ${up ? "border-emerald-400/30 bg-emerald-400/12 text-emerald-200" : "border-rose-400/30 bg-rose-400/12 text-rose-200"}`}
                      >
                        {up ? "▲" : "▼"} {Math.abs(pct)}%
                      </span>
                    );
                  })()}
                </div>
                <div className="mt-2.5 flex flex-wrap gap-x-5 gap-y-2 text-[11px]">
                  <div>
                    <div className="text-white/40">Pesanan</div>
                    <div className="mt-0.5 text-sm font-bold">{d.pulsaBisnis.hariIni.pesanan}</div>
                  </div>
                  {d.pulsaBisnis.labaKotorHariIni && (
                    <div>
                      <div className="text-white/40">
                        Laba kotor
                        {d.pulsaBisnis.labaKotorHariIni.itemTanpaModal > 0 && (
                          <span
                            className="ml-1 cursor-help text-amber-300/80"
                            title={`${d.pulsaBisnis.labaKotorHariIni.itemTanpaModal} item belum punya harga modal — laba kotor lebih tinggi dari seharusnya`}
                          >
                            ⚠
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 text-sm font-bold">
                        {formatRupiah(d.pulsaBisnis.labaKotorHariIni.laba)}
                      </div>
                    </div>
                  )}
                  <div>
                    <div className="text-white/40">Rata-rata</div>
                    <div className="mt-0.5 text-sm font-bold">{formatRupiah(d.pulsaBisnis.hariIni.rataRata)}</div>
                  </div>
                  <div>
                    <div className="text-white/40">Kemarin</div>
                    <div className="mt-0.5 text-sm font-bold text-white/60">
                      {formatRupiah(d.pulsaBisnis.kemarin.omzet)}
                      <MiniDelta today={d.pulsaBisnis.hariIni.omzet} base={d.pulsaBisnis.kemarin.omzet} />
                    </div>
                  </div>
                  <div>
                    {/* Pembanding pola mingguan (Fase C): hari yang sama pekan lalu. */}
                    <div className="text-white/40">Minggu lalu</div>
                    <div className="mt-0.5 text-sm font-bold text-white/60">
                      {formatRupiah(d.pulsaBisnis.mingguLalu.omzet)}
                      <MiniDelta today={d.pulsaBisnis.hariIni.omzet} base={d.pulsaBisnis.mingguLalu.omzet} />
                    </div>
                  </div>
                </div>
              </div>
              <div>
                <div className="flex h-14 items-end gap-1">
                  {(() => {
                    const max = Math.max(...d.pulsaBisnis.tujuhHari.map((h) => h.omzet), 1);
                    return d.pulsaBisnis.tujuhHari.map((h, i) => (
                      <span
                        key={h.tanggal}
                        title={`${h.tanggal}: ${formatRupiah(h.omzet)}`}
                        style={{ height: `${Math.max(8, (h.omzet / max) * 100)}%` }}
                        className={`min-w-[10px] flex-1 rounded-t-md ${i === 6 ? "bg-gradient-to-t from-pink-500 to-white shadow-[0_0_14px_rgba(236,72,153,.5)]" : "bg-gradient-to-t from-pink-500/40 to-pink-300/80"}`}
                      />
                    ));
                  })()}
                </div>
                <div className="mt-1 flex gap-1">
                  {d.pulsaBisnis.tujuhHari.map((h) => (
                    <span key={h.tanggal} className="min-w-[10px] flex-1 text-center text-[9px] text-white/35">
                      {DAY_SHORT[new Date(`${h.tanggal}T00:00:00`).getDay()]}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}
        </Card>
    ),
    tim: d && visibility.tim && (
        <Card
          title="Tim Hari Ini"
          subtitle={`${d.timHariIni?.aktif ?? "–"} karyawan aktif`}
          href="/dashboard/hris/attendance"
          onGo={go}
          onAskDo={onAskDo}
          askDoPrompt={buildAskDoPrompt("tim", d)}
          failed={failedSet.has("timHariIni")}
        >
          {d.timHariIni && (
            <>
              <div className="flex gap-1.5">
                {(
                  [
                    { n: d.timHariIni.hadir, t: "Hadir", c: "text-emerald-300" },
                    { n: d.timHariIni.terlambat, t: "Telat", c: "text-amber-300" },
                    { n: d.timHariIni.belum, t: "Belum", c: "text-rose-300" },
                    { n: d.timHariIni.cuti, t: "Cuti", c: "text-sky-300" },
                  ] as const
                ).map((p) => (
                  <div key={p.t} className="flex-1 rounded-xl border border-white/8 bg-white/5 px-1 py-2 text-center">
                    <div className={`text-lg font-extrabold ${p.c}`}>{p.n}</div>
                    <div className="text-[9.5px] text-white/40">{p.t}</div>
                  </div>
                ))}
              </div>
              {d.timHariIni.aktif > 0 && (
                <div className="mt-2.5 flex h-1.5 overflow-hidden rounded-full bg-white/8">
                  <i style={{ width: `${(d.timHariIni.hadir / d.timHariIni.aktif) * 100}%` }} className="bg-emerald-400" />
                  <i style={{ width: `${(d.timHariIni.terlambat / d.timHariIni.aktif) * 100}%` }} className="bg-amber-400" />
                  <i style={{ width: `${(d.timHariIni.belum / d.timHariIni.aktif) * 100}%` }} className="bg-rose-400" />
                  <i style={{ width: `${(d.timHariIni.cuti / d.timHariIni.aktif) * 100}%` }} className="bg-sky-400" />
                </div>
              )}
            </>
          )}
        </Card>
    ),
    keputusan: d && visibility.keputusan && (
        <Card
          title="Perlu Keputusan"
          subtitle={`${d.perluKeputusan?.total ?? "–"} item menunggu`}
          href="/dashboard/hris/leaves"
          onGo={go}
          onAskDo={onAskDo}
          askDoPrompt={buildAskDoPrompt("keputusan", d)}
          failed={failedSet.has("perluKeputusan")}
        >
          {onOpenInbox && (d.perluKeputusan?.total ?? 0) > 0 && (
            <button
              type="button"
              onClick={onOpenInbox}
              className="mb-2 w-full rounded-xl bg-pink-600/85 px-3 py-2 text-xs font-bold text-white transition hover:bg-pink-500"
            >
              Tangani sekarang
            </button>
          )}
          {d.perluKeputusan && (
            <div className="-mx-1 flex flex-col">
              {(
                [
                  { t: "Pengajuan cuti", n: d.perluKeputusan.cuti, href: "/dashboard/hris/leaves" },
                  { t: "Lembur & pinjaman", n: d.perluKeputusan.lembur + d.perluKeputusan.pinjaman, href: "/dashboard/hris/overtime" },
                  { t: "PO draft menunggu", n: d.perluKeputusan.poDraft, href: "/dashboard/purchasing/approval" },
                  { t: "Kandidat baru", n: d.perluKeputusan.kandidatBaru, href: "/dashboard/hris/candidates" },
                ] as const
              ).map((r) => (
                <button
                  key={r.t}
                  type="button"
                  onClick={() => go(r.href)}
                  className="flex items-center gap-2.5 rounded-xl px-2 py-1.5 text-left transition hover:bg-white/8"
                >
                  <span className="min-w-0 flex-1 truncate text-xs">{r.t}</span>
                  <span
                    className={`grid h-5 min-w-5 shrink-0 place-items-center rounded-full px-1.5 text-[11px] font-extrabold ${r.n > 0 ? "bg-gradient-to-br from-pink-500 to-rose-600 text-white" : "bg-white/8 text-white/35"}`}
                  >
                    {r.n}
                  </span>
                  <span className="shrink-0 text-white/30">›</span>
                </button>
              ))}
            </div>
          )}
        </Card>
    ),
    stok: d && visibility.stok && (
        <Card
          title="Stok Menipis"
          subtitle={
            d.stokMenipis
              ? d.stokMenipis.jumlah > 0
                ? `${d.stokMenipis.jumlah} bahan di bawah minimum`
                : "Semua stok aman"
              : "–"
          }
          href="/dashboard/inventory/low-stock"
          onGo={go}
          onAskDo={onAskDo}
          askDoPrompt={buildAskDoPrompt("stok", d)}
          failed={failedSet.has("stokMenipis")}
        >
          {d.stokMenipis &&
            (d.stokMenipis.jumlah === 0 ? (
              <div className="rounded-2xl bg-emerald-400/8 px-3 py-2.5 text-xs text-emerald-200">
                Tidak ada bahan di bawah batas minimum.
              </div>
            ) : (
              <div className="flex flex-col gap-2.5">
                {d.stokMenipis.teratas.map((item) => (
                  <div key={item.bahan}>
                    <div className="mb-1 flex justify-between text-[11.5px]">
                      <span className="truncate font-semibold">{item.bahan}</span>
                      <span className="shrink-0 text-white/40">
                        {item.tersedia} / min {item.minimum}
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-white/8">
                      <i
                        style={{ width: `${item.minimum > 0 ? Math.min(100, (item.tersedia / item.minimum) * 100) : 0}%` }}
                        className="block h-full rounded-full bg-gradient-to-r from-rose-400 to-amber-400"
                      />
                    </div>
                  </div>
                ))}
              </div>
            ))}
        </Card>
    ),
    member: d && visibility.member && (
        <Card
          title="Member & Loyalty"
          subtitle="7 hari terakhir"
          href="/dashboard/crm/members"
          onGo={go}
          onAskDo={onAskDo}
          askDoPrompt={buildAskDoPrompt("member", d)}
          failed={failedSet.has("member")}
        >
          {d.member && (
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  { n: d.member.memberBaru7Hari, t: "Member baru" },
                  { n: d.member.xpTerdistribusi7Hari.toLocaleString("id-ID"), t: "XP keluar" },
                  { n: d.member.rewardDitukar7Hari, t: "Reward ditukar" },
                ] as const
              ).map((c) => (
                <div key={c.t} className="rounded-xl border border-white/8 bg-white/5 px-2 py-2.5 text-center">
                  <div className="text-base font-extrabold">{c.n}</div>
                  <div className="mt-0.5 text-[9.5px] leading-tight text-white/40">{c.t}</div>
                </div>
              ))}
            </div>
          )}
        </Card>
    ),
  };

  const cards = (
    <>
      {onPilihPeriode && (
        <PeriodSwitcher periode={periode} onPilih={onPilihPeriode} state={state} />
      )}

      {state.status === "loading" && (
        <>
          <Skeleton wide />
          <Skeleton />
          <Skeleton />
        </>
      )}

      {state.status === "error" && (
        <div className={`${CARD} col-span-2 p-4 text-xs text-white/60`}>
          Ringkasan monitoring belum bisa dimuat — dicoba lagi otomatis.
        </div>
      )}

      {normalizeWidgetOrder(order).map((key) => (
        <Fragment key={key}>{cardNodes[key]}</Fragment>
      ))}
    </>
  );

  return (
    <>
      {/* Laptop: papan tetap menempel di kanan seperti widget macOS.
          Laptop kecil (lg) memakai satu kolom sempit supaya ikon desktop tidak
          tertutup; dua kolom lebar baru mulai xl (Fase C). */}
      <section
        aria-label="Papan monitoring bisnis"
        className="pointer-events-auto fixed right-5 top-12 z-20 hidden max-h-[calc(100vh-140px)] w-[340px] grid-cols-1 content-start gap-3 overflow-y-auto pr-1 lg:grid xl:w-[560px] xl:grid-cols-2"
      >
        {cards}
      </section>

      {/* Ponsel/tablet: panel satu kolom — monitoring adalah alasan utama
          owner membuka /arkiv-os dari HP, jadi terbuka secara default. */}
      <MobileMonitorSheet>{cards}</MobileMonitorSheet>
    </>
  );
}

/**
 * Panel monitoring versi layar kecil. Menubar tetap terlihat (mulai di bawah
 * top-9) dan dock tetap bisa ditekan (z panel di bawah dock); "Tutup"
 * menampilkan desktop, pil "Monitoring" membukanya kembali.
 */
function MobileMonitorSheet({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(true);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-24 right-4 z-[25] rounded-full border border-white/18 bg-slate-950/75 px-4 py-2.5 text-xs font-bold text-white shadow-2xl backdrop-blur-2xl lg:hidden"
      >
        Monitoring
      </button>
    );
  }

  return (
    <div className="fixed inset-x-0 bottom-0 top-9 z-[25] overflow-y-auto overscroll-contain bg-[#0b1020]/85 backdrop-blur-xl lg:hidden">
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-white/10 bg-black/35 px-4 py-3 backdrop-blur-2xl">
        <div>
          <div className="text-sm font-bold">Monitoring</div>
          <div className="text-[11px] text-white/40">Diperbarui tiap 60 detik</div>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-full border border-white/14 bg-white/8 px-3 py-1.5 text-xs font-semibold text-white/70 transition hover:bg-white/16 hover:text-white"
        >
          Tutup
        </button>
      </div>
      <div className="grid grid-cols-1 content-start gap-3 px-4 pb-32 pt-4">{children}</div>
    </div>
  );
}
