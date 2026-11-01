"use client";

import Link from "next/link";
import { Gem, Loader2 } from "lucide-react";
import { ScrollRegion } from "@/components/ui/scroll-region";
import { formatNumber } from "@/lib/format";
import { useCollectibleIdleReport } from "../queries";

/**
 * Jatah avatar member yang belum dipakai (1 jatah tiap interval XP). Angka
 * menganggur yang tinggi dibanding artwork aktif berarti tim perlu
 * menyiapkan artwork baru sebelum member lama kehabisan pilihan.
 */
export function CollectibleIdleSection() {
  const query = useCollectibleIdleReport();
  const data = query.data;
  const error = query.error instanceof Error ? query.error.message : null;
  const members = data?.members ?? [];

  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Gem className="size-5 text-violet-600" />
            <h2 className="text-base font-semibold text-slate-950">Jatah Avatar Menganggur</h2>
            {query.isFetching && <Loader2 className="size-4 animate-spin text-slate-400" aria-label="Memuat" />}
          </div>
          <p className="mt-1 text-sm text-slate-500">
            Member dengan jatah avatar yang belum dipakai. Siapkan artwork baru sebelum member lama kehabisan pilihan.
          </p>
        </div>
        {data && (
          <dl className="grid shrink-0 grid-cols-3 gap-4 text-right">
            <IdleStat label="XP per jatah" value={formatNumber(data.interval_xp)} />
            <IdleStat label="Jatah menganggur" value={formatNumber(data.total_idle)} />
            <IdleStat label="Artwork aktif" value={formatNumber(data.active_artworks)} />
          </dl>
        )}
      </div>

      {error ? (
        <div className="px-4 py-8 text-center text-sm text-red-700">{error}</div>
      ) : query.isLoading ? (
        <div className="px-4 py-8 text-center text-sm text-slate-500">Memuat...</div>
      ) : members.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-slate-500">Belum ada member yang mencapai jatah avatar.</div>
      ) : (
        <ScrollRegion label="Tabel jatah avatar menganggur" className="max-h-96 overflow-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="sticky top-0 bg-white">
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-4 py-3 font-medium">Member</th>
                <th className="px-4 py-3 text-right font-medium">Total XP</th>
                <th className="px-4 py-3 text-right font-medium">Jatah</th>
                <th className="px-4 py-3 text-right font-medium">Terpakai</th>
                <th className="px-4 py-3 text-right font-medium">Menganggur</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {members.map((member) => (
                <tr key={member.customer_id}>
                  <td className="px-4 py-3">
                    <Link
                      href={`/dashboard/crm/members/${member.customer_id}`}
                      className="font-medium text-slate-900 hover:text-slate-600"
                    >
                      {member.name}
                    </Link>
                    <div className="text-xs text-slate-500">{member.phone || "-"}</div>
                  </td>
                  <td className="px-4 py-3 text-right text-slate-600">{formatNumber(member.total_xp)}</td>
                  <td className="px-4 py-3 text-right text-slate-600">{formatNumber(member.quota)}</td>
                  <td className="px-4 py-3 text-right text-slate-600">{formatNumber(member.used)}</td>
                  <td className="px-4 py-3 text-right font-semibold text-slate-950">{formatNumber(member.idle)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollRegion>
      )}
    </section>
  );
}

function IdleStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="text-lg font-semibold text-slate-950">{value}</dd>
    </div>
  );
}
