"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatNumber } from "@/lib/format";
import { useDebounced } from "@/features/gym/use-debounced";
import { COACHING_KEYS, coachingApi, type PtMemberHit } from "../api";

/**
 * Cari member (nama atau HP) lalu pilih. Dengan classTypeId, tiap hasil
 * menampilkan kredit PT yang masih bisa dipakai untuk jenis sesi itu.
 */
export function MemberPicker({
  classTypeId,
  exclude = [],
  onPick,
}: {
  classTypeId?: string;
  exclude?: string[];
  onPick: (member: PtMemberHit) => void;
}) {
  const [q, setQ] = useState("");
  const term = useDebounced(q.trim());
  const hits = useQuery({
    queryKey: [...COACHING_KEYS.members, term, classTypeId ?? ""],
    queryFn: () => coachingApi.members(term, classTypeId),
    enabled: term.length >= 2,
  });
  const rows = (hits.data ?? []).filter((m) => !exclude.includes(m.id));

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-9"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Nama atau nomor HP member"
          aria-label="Cari member"
        />
      </div>
      {term.length < 2 ? null : hits.isLoading ? (
        <p className="text-sm text-muted-foreground">Mencari…</p>
      ) : hits.error ? (
        <p className="text-sm text-danger">{hits.error.message}</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Member tidak ditemukan.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {rows.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-3 rounded-2xl bg-surface-2 px-3 py-2">
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  {m.name ?? "Tanpa nama"}
                  {m.is_active === false && <Badge variant="destructive">Nonaktif</Badge>}
                </span>
                <span className="block font-mono text-xs text-muted-foreground">
                  {m.phone}
                  {classTypeId && ` · ${formatNumber(m.pt_credits)} kredit PT`}
                </span>
              </span>
              <Button type="button" size="sm" variant="outline" onClick={() => onPick(m)}>
                Pilih
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
