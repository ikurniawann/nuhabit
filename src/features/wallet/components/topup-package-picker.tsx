"use client";

import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { rupiah, walletApi, type TopupPackage } from "../api";

/**
 * Pilihan paket top-up di layar kasir (paket aktif untuk cabang kasir).
 * Tidak tampil bila belum ada paket; nominal bebas tetap jalan seperti biasa.
 */
export function TopupPackagePicker({
  selectedId,
  onSelect,
}: {
  selectedId: string | null;
  onSelect: (pkg: TopupPackage) => void;
}) {
  const packages = useQuery({ queryKey: ["wallet", "packages", "cashier"], queryFn: () => walletApi.packages("cashier") });
  const rows = packages.data ?? [];
  if (rows.length === 0) return null;

  return (
    <section className="rounded-2xl border border-gray-200/70 bg-card p-4">
      <div className="mb-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Paket top-up</div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {rows.map((pkg) => {
          const bonus = pkg.credit_idr - pkg.price_idr;
          return (
            <button
              key={pkg.id}
              type="button"
              onClick={() => onSelect(pkg)}
              className={cn(
                "rounded-xl border px-3 py-3 text-left transition-colors",
                selectedId === pkg.id
                  ? "border-primary/40 bg-primary/10 ring-1 ring-primary/30"
                  : "border-gray-200/70 bg-white hover:border-primary/30 hover:bg-primary/5"
              )}
            >
              <div className="text-sm font-semibold text-foreground">{pkg.name}</div>
              <div className="mt-0.5 text-sm">Bayar {rupiah(pkg.price_idr)}</div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">
                Saldo {rupiah(pkg.credit_idr)}
                {bonus > 0 ? ` (bonus ${rupiah(bonus)})` : ""}
                {pkg.validity_days ? ` · berlaku ${pkg.validity_days} hari` : ""}
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
