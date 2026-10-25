"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Search, UserPlus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Can } from "@/components/iam/can";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableNote } from "@/features/crm/engagement/components/shared";
import { SELECT } from "@/features/gym/shared";
import { ImportButton } from "@/features/data-import/import-dialog";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { formatDate, formatDateTime, formatNumber } from "@/lib/format";
import { MEMBER_KEYS, membersApi } from "../api";
import {
  MEMBER_FLAGS,
  memberApiQuery,
  memberParamsToSearch,
  pageCount,
  parseMemberParams,
  toggleFlag,
  type MemberListParams,
} from "../list-params";
import { MemberLink } from "../member-link";
import { RegisterMemberDialog } from "./register-member-dialog";

/** Gym → Member: cari dan saring member, filter dan halaman tersimpan di URL. */
export function MembersPage() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const params = parseMemberParams(searchParams);
  const [q, setQ] = useState(params.q);
  const term = useDebouncedValue(q.trim(), 300);
  const [registering, setRegistering] = useState(false);

  const navigate = (next: MemberListParams) => {
    const search = memberParamsToSearch(next);
    router.replace(search ? `${pathname}?${search}` : pathname, { scroll: false });
  };

  useEffect(() => {
    if (term !== params.q) navigate({ ...params, q: term, page: 1 });
    // Only the debounced term drives this; params comes from the URL it writes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term]);

  const query = memberApiQuery(params);
  const list = useQuery({
    queryKey: MEMBER_KEYS.list(query),
    queryFn: () => membersApi.list(query),
    placeholderData: keepPreviousData,
  });
  const branches = useQuery({ queryKey: MEMBER_KEYS.branches, queryFn: membersApi.branches, staleTime: 5 * 60_000 });
  const rows = list.data?.rows ?? [];
  const total = list.data?.total ?? 0;
  const pages = pageCount(total);

  return (
    <div className="space-y-4">
      <PageHeader
        kicker="Gym & Kelas"
        title="Member"
        description="Cari member dengan nama, nomor HP, email, atau kode member. Klik nama untuk membuka profil lengkapnya."
        actions={
          <>
            <ImportButton
              menu="gym.members"
              title="Impor member"
              description="Nomor telepon menjadi kunci, email kunci kedua. Saldo kredit dan pass yang diisi dicatat sekali sebagai saldo awal."
              endpoint="/api/gym/members/import"
              templateHref="/api/gym/members/import/template"
              onImported={() => void queryClient.invalidateQueries({ queryKey: MEMBER_KEYS.all })}
            />
            <Can menu="gym.members" action="create" mode="disable">
              <Button onClick={() => setRegistering(true)}>
                <UserPlus /> Tambah member
              </Button>
            </Can>
          </>
        }
      />

      <Card className="gap-3 p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_14rem]">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              className="pl-9"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Nama, nomor HP, email, atau kode member"
              aria-label="Cari member"
            />
          </div>
          <select
            className={SELECT}
            value={params.branch_id}
            onChange={(e) => navigate({ ...params, branch_id: e.target.value, page: 1 })}
            aria-label="Cabang"
          >
            <option value="">Semua cabang</option>
            {(branches.data ?? []).map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
        <div role="group" aria-label="Filter member" className="flex flex-wrap gap-2">
          {MEMBER_FLAGS.map((f) => {
            const on = params.flags.includes(f.key);
            return (
              <Button
                key={f.key}
                type="button"
                size="sm"
                variant={on ? "ink" : "outline"}
                aria-pressed={on}
                onClick={() => navigate(toggleFlag(params, f.key))}
              >
                {f.label}
              </Button>
            );
          })}
        </div>
      </Card>

      <Card className="py-0">
        {list.isLoading ? (
          <TableNote>Memuat member…</TableNote>
        ) : list.error ? (
          <TableNote tone="danger">{list.error.message}</TableNote>
        ) : rows.length === 0 ? (
          <TableNote>Tidak ada member yang cocok dengan pencarian dan filter ini.</TableNote>
        ) : (
          <Table aria-label="Daftar member" aria-busy={list.isFetching}>
            <TableHeader>
              <TableRow>
                <TableHead>Member</TableHead>
                <TableHead>Nomor HP</TableHead>
                <TableHead>Pass aktif</TableHead>
                <TableHead className="text-right">Saldo kredit</TableHead>
                <TableHead>Kunjungan terakhir</TableHead>
                <TableHead className="text-right">Booking 7 hari</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="max-w-[16rem] whitespace-normal">
                    <MemberLink id={m.id} name={m.name ?? "Tanpa nama"} />
                    {!m.is_active && (
                      <Badge variant="destructive" className="ml-2">
                        Nonaktif
                      </Badge>
                    )}
                    <p className="text-xs text-muted-foreground">{[m.member_code, m.email].filter(Boolean).join(" · ")}</p>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{m.phone}</TableCell>
                  <TableCell>
                    {m.pass_until ? (
                      <span className="text-sm">
                        {m.pass_name}
                        <span className="block text-xs text-muted-foreground">s.d. {formatDate(m.pass_until)}</span>
                      </span>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatNumber(m.balance)}</TableCell>
                  <TableCell className="text-sm">{formatDateTime(m.last_visit, "Belum pernah")}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatNumber(m.bookings_next_7_days)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {total > 0 && (
        <nav aria-label="Halaman daftar member" className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <p className="text-muted-foreground">
            {formatNumber(total)} member · halaman {formatNumber(params.page)} dari {formatNumber(pages)}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={params.page <= 1}
              onClick={() => navigate({ ...params, page: params.page - 1 })}
            >
              <ChevronLeft /> Sebelumnya
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={params.page >= pages}
              onClick={() => navigate({ ...params, page: params.page + 1 })}
            >
              Berikutnya <ChevronRight />
            </Button>
          </div>
        </nav>
      )}

      {registering && <RegisterMemberDialog onClose={() => setRegistering(false)} />}
    </div>
  );
}
