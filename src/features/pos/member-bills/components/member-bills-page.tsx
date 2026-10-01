"use client";

import { useDeferredValue, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Loader2, ReceiptText, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { fetchMemberBills, memberBillKeys } from "../api";
import { ageText, formatIdr } from "../format";
import { MemberBillDetailPanel } from "./member-bill-detail";

/**
 * POS → Operasional → Tagihan (owner 2026-10-01): pilih member → lihat order
 * belum lunas & sisa tagihan → bayar sebagian / lunas dengan metode bayar POS.
 */
export function MemberBillsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const selectedId = searchParams.get("member");
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);

  const listQuery = useQuery({
    queryKey: memberBillKeys.list(deferredSearch),
    queryFn: () => fetchMemberBills(deferredSearch),
    refetchInterval: 30_000,
  });
  const members = listQuery.data ?? [];
  const totalOutstanding = members.reduce((sum, member) => sum + member.balance.outstanding, 0);

  const select = (customerId: string | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (customerId) params.set("member", customerId);
    else params.delete("member");
    router.replace(`${pathname}${params.size ? `?${params}` : ""}`, { scroll: false });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Tagihan</h1>
          <p className="text-sm text-muted-foreground">
            Order member yang belum lunas — bayar sebagian atau lunas sekaligus.
          </p>
        </div>
        <div className="rounded-xl border border-gray-200/70 bg-white px-4 py-2 text-right dark:bg-card">
          <div className="text-xs text-muted-foreground">Total sisa tagihan ({members.length} member)</div>
          <div className="text-lg font-bold tabular-nums text-primary">{formatIdr(totalOutstanding)}</div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-[18rem_minmax(0,1fr)] lg:grid-cols-[22rem_minmax(0,1fr)]">
        <aside className={cn("space-y-3", selectedId && "hidden md:block")}>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Cari nama / nomor HP member…"
              className="h-11 w-full rounded-xl border border-gray-200 bg-white pl-9 pr-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring dark:bg-card"
            />
          </div>
          {listQuery.isLoading ? (
            <div className="flex items-center gap-2 px-1 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Memuat tagihan…
            </div>
          ) : listQuery.error ? (
            <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {(listQuery.error as Error).message}
            </div>
          ) : members.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-300 px-4 py-10 text-center text-sm text-muted-foreground">
              {search ? "Member tidak ditemukan." : "Tidak ada tagihan member yang terbuka."}
            </div>
          ) : (
            <ul className="space-y-2">
              {members.map((member) => {
                const active = member.customer_id === selectedId;
                return (
                  <li key={member.customer_id}>
                    <button
                      type="button"
                      aria-current={active || undefined}
                      onClick={() => select(member.customer_id)}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left transition",
                        active
                          ? "border-primary bg-primary/5 ring-1 ring-primary/30"
                          : "border-gray-200/70 bg-white hover:border-primary/40 dark:bg-card"
                      )}
                    >
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                        {member.name.charAt(0).toUpperCase()}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-foreground">{member.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {member.open_order_count} order
                          {member.oldest_order_at ? ` · ${ageText(member.oldest_order_at)}` : ""}
                          {member.phone ? ` · ${member.phone}` : ""}
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block text-sm font-bold tabular-nums text-foreground">
                          {formatIdr(member.balance.outstanding)}
                        </span>
                        {member.balance.credit > 0 ? (
                          <span className="block text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
                            dicicil {formatIdr(member.balance.credit)}
                          </span>
                        ) : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>

        <section className={cn("min-w-0", !selectedId && "hidden md:block")}>
          {selectedId ? (
            <MemberBillDetailPanel key={selectedId} customerId={selectedId} onBack={() => select(null)} />
          ) : (
            <div className="flex h-full min-h-64 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-gray-300 p-8 text-center text-sm text-muted-foreground">
              <ReceiptText className="h-8 w-8 opacity-50" />
              Pilih member di sebelah kiri untuk melihat tagihannya.
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
