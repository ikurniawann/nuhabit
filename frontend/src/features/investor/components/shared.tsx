"use client";

import { useQuery } from "@tanstack/react-query";
import { ResponsiveContainer } from "recharts";
import { Card } from "@/components/ui/card";
import { Field, TableNote } from "@/features/crm/engagement/components/shared";
import { SELECT } from "@/features/gym/shared";
import { zoneAbbr, zoneName } from "@/lib/timezone";
import { INVESTOR_KEYS, investorApi, type Branch } from "../api";

/** Warna seri grafik investor: hijau brand lalu pasangan kontras (bukan lime di atas terang). */
export const SERIES = [
  "var(--color-forest)",
  "var(--color-success)",
  "var(--color-ochre)",
  "var(--color-info)",
  "var(--color-jungle)",
  "var(--color-chart-muted)",
];

export const AXIS = { fontSize: 11, fill: "var(--color-muted-foreground)" };

export const tooltipStyle = {
  contentStyle: { borderRadius: 12, border: "none", background: "var(--color-ink)", color: "var(--color-on-ink)", fontSize: 12 },
  labelStyle: { color: "var(--color-on-ink)" },
  itemStyle: { color: "var(--color-on-ink)" },
  cursor: { fill: "var(--color-surface-2)" },
};

export function useBranches() {
  return useQuery({ queryKey: INVESTOR_KEYS.branches, queryFn: investorApi.branches, staleTime: 5 * 60_000 });
}

/** Zona hari laporan: zona cabang yang difilter, atau WIB untuk semua cabang. */
export function zoneNote(branchId: string, branches: Branch[] | undefined): string {
  if (!branchId) return "Semua cabang: hari dihitung dalam WIB (Asia/Jakarta).";
  const zone = branches?.find((b) => b.id === branchId)?.timezone;
  return `Hari dihitung dalam ${zoneAbbr(zone)} (${zoneName(zone)}), zona cabang ini.`;
}

/** Pilihan cabang untuk halaman investor; "" berarti semua cabang. */
export function BranchFilter({
  value,
  onChange,
  branches,
  children,
}: {
  value: string;
  onChange: (branchId: string) => void;
  branches: Branch[] | undefined;
  children?: React.ReactNode;
}) {
  return (
    <Card className="p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Cabang">
          <select className={SELECT} value={value} onChange={(e) => onChange(e.target.value)}>
            <option value="">Semua cabang</option>
            {(branches ?? []).map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </Field>
        {children}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">{zoneNote(value, branches)}</p>
    </Card>
  );
}

/** Kartu grafik dengan judul; ringkasan dibacakan pembaca layar sebagai gambar. */
export function ChartCard({ title, summary, children }: { title: string; summary: string; children: React.ReactElement }) {
  return (
    <Card className="p-4">
      <h3 className="text-sm font-semibold">{title}</h3>
      <figure role="img" aria-label={summary} className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          {children}
        </ResponsiveContainer>
      </figure>
    </Card>
  );
}

/** Pesan muat atau gagal di tempat konten. */
export function QueryState({ loading, error }: { loading: boolean; error: unknown }) {
  if (error) return <TableNote tone="danger">{error instanceof Error ? error.message : "Gagal memuat data."}</TableNote>;
  if (loading) return <TableNote>Memuat...</TableNote>;
  return null;
}
