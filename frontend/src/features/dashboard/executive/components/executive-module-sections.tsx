import Link from "next/link";
import { Package, Truck } from "lucide-react";
import { IconTile } from "@/components/ui/stat-card";
import { cn } from "@/lib/utils";
import type { ExecutiveDashboard } from "@/lib/dashboard/executive";
import { formatNumber, formatRupiahCompact } from "@/lib/format";
import { SectionCard } from "./executive-parts";

/** Produk, stok, purchasing, payroll & SDM, dan member: kartu modul di bawah hero. */
export function ExecutiveModuleSections({
  data,
  failed,
}: {
  data: ExecutiveDashboard;
  failed: Set<string>;
}) {
  const o = data.overview;
  return (
    <>
      {/* Produk · Stok · Purchasing */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <SectionCard
          title="Produk terlaris · 7 hari"
          href="/dashboard/pos"
          failed={failed.has("topProduk")}
        >
          {data.topProduk7Hari &&
            (data.topProduk7Hari.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Belum ada penjualan 7 hari terakhir.
              </p>
            ) : (
              <ol className="space-y-2.5">
                {data.topProduk7Hari.map((p, i) => (
                  <li
                    key={p.produk}
                    className="flex items-center gap-3 text-sm"
                  >
                    <span
                      className={cn(
                        "flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold tabular-nums",
                        i === 0 ? "bg-ink text-on-ink" : "bg-surface text-body",
                      )}
                    >
                      {i + 1}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-foreground">
                      {p.produk}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                      {p.qty}×
                    </span>
                    <span className="shrink-0 font-semibold text-foreground tabular-nums">
                      {formatRupiahCompact(p.omzet)}
                    </span>
                  </li>
                ))}
              </ol>
            ))}
        </SectionCard>

        <SectionCard
          title="Inventori"
          href="/dashboard/inventory/low-stock"
          hrefLabel="Stok menipis"
          failed={
            failed.has("nilaiPersediaan") && failed.has("overview:stokMenipis")
          }
        >
          <div className="space-y-3">
            {data.nilaiPersediaan !== null && (
              <div className="flex items-start gap-3">
                <IconTile tone="default">
                  <Package />
                </IconTile>
                <div>
                  <p className="text-xs text-muted-foreground">
                    Nilai persediaan saat ini
                  </p>
                  <p className="text-2xl font-bold tracking-tight text-foreground tabular-nums">
                    {formatRupiahCompact(data.nilaiPersediaan)}
                  </p>
                </div>
              </div>
            )}
            {o.stokMenipis && (
              <p
                className={cn(
                  "rounded-2xl px-3 py-2.5 text-sm",
                  o.stokMenipis.jumlah > 0
                    ? "bg-warning-soft text-warning"
                    : "bg-success-soft text-success",
                )}
              >
                {o.stokMenipis.jumlah > 0
                  ? `${o.stokMenipis.jumlah} bahan di bawah minimum`
                  : "Semua stok di atas batas minimum"}
              </p>
            )}
          </div>
        </SectionCard>

        <SectionCard
          title="Purchasing bulan ini"
          href="/dashboard/purchasing"
          failed={failed.has("purchasing")}
        >
          {data.purchasingBulanIni && (
            <div className="space-y-3">
              <div className="flex items-start gap-3">
                <IconTile tone="info">
                  <Truck />
                </IconTile>
                <div>
                  <p className="text-2xl font-bold tracking-tight text-foreground tabular-nums">
                    {data.purchasingBulanIni.jumlahPo}{" "}
                    <span className="text-sm font-semibold text-muted-foreground">
                      PO
                    </span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatRupiahCompact(data.purchasingBulanIni.nilaiTotal)}
                  </p>
                </div>
              </div>
              {data.purchasingBulanIni.perStatus.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {data.purchasingBulanIni.perStatus.map((s) => (
                    <span
                      key={s.status}
                      className="rounded-full bg-surface px-2.5 py-0.5 text-xs text-body"
                    >
                      {s.status}{" "}
                      <strong className="tabular-nums">{s.jumlah}</strong>
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
        <SectionCard
          title="Payroll & SDM"
          href="/dashboard/hris/payroll"
          failed={failed.has("payroll")}
        >
          <div className="space-y-3 text-sm">
            {data.payrollTerakhir ? (
              <div>
                <p className="text-xs text-muted-foreground">
                  Run terakhir · {data.payrollTerakhir.periode}
                </p>
                <p className="mt-1 flex flex-wrap items-center gap-2 text-2xl font-bold tracking-tight text-foreground tabular-nums">
                  {formatRupiahCompact(data.payrollTerakhir.totalNet)}
                  <span className="rounded-full bg-surface px-2.5 py-0.5 text-xs font-medium tracking-normal text-body">
                    {data.payrollTerakhir.status}
                  </span>
                </p>
              </div>
            ) : (
              <p className="text-muted-foreground">
                Belum ada payroll run. Jalankan payroll dari menu HRIS.
              </p>
            )}
            {data.kontrakHabis30Hari !== null && (
              <Link
                href="/dashboard/hris/contracts"
                className={cn(
                  "block rounded-2xl px-3 py-2.5 text-sm transition-colors",
                  data.kontrakHabis30Hari > 0
                    ? "bg-warning-soft text-warning hover:bg-warning-soft/70"
                    : "bg-surface-2 text-muted-foreground hover:bg-surface",
                )}
              >
                {data.kontrakHabis30Hari > 0
                  ? `${data.kontrakHabis30Hari} kontrak berakhir dalam 30 hari`
                  : "Tidak ada kontrak berakhir dalam 30 hari"}
              </Link>
            )}
          </div>
        </SectionCard>

        <SectionCard
          title="Member & loyalty · 7 hari"
          href="/dashboard/crm/members"
          failed={failed.has("overview:member")}
        >
          {o.member && (
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  { label: "Member baru", value: o.member.memberBaru7Hari },
                  { label: "XP keluar", value: o.member.xpTerdistribusi7Hari },
                  {
                    label: "Reward ditukar",
                    value: o.member.rewardDitukar7Hari,
                  },
                ] as const
              ).map((m) => (
                <div key={m.label} className="rounded-2xl bg-surface-2 p-3">
                  <p className="text-xl font-bold text-foreground tabular-nums">
                    {formatNumber(m.value)}
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {m.label}
                  </p>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>
    </>
  );
}
