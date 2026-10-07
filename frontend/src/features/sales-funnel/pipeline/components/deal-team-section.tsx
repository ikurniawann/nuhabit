"use client";

import { useState } from "react";
import { Users, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useOwners } from "@/features/crm/advance/queries";
import { useAddDealMember, useDealMembers, useRemoveDealMember } from "../queries";
import { DEAL_MEMBER_ROLE_LABELS, type DealMember } from "../types";

/** EPIC-050 T-3.1 — tim deal (banyak orang per deal) di dialog detail deal. */
export function DealTeamSection({ dealId, enabled, ownerUserId }: { dealId: string; enabled: boolean; ownerUserId: string | null }) {
  const membersQuery = useDealMembers(dealId, enabled);
  const ownersQuery = useOwners();
  const addMutation = useAddDealMember(dealId);
  const removeMutation = useRemoveDealMember(dealId);
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState<DealMember["role"]>("support");
  const members = membersQuery.data ?? [];
  const candidates = (ownersQuery.data ?? []).filter((o) => o.id !== ownerUserId && !members.some((m) => m.user_id === o.id));

  return (
    <div className="rounded-xl border border-gray-200/80 bg-white p-3">
      <p className="mb-2 inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">
        <Users className="h-3.5 w-3.5" /> Tim deal
      </p>
      {members.length === 0 ? (
        <p className="text-xs text-gray-400">Belum ada anggota selain penanggung jawab.</p>
      ) : (
        <ul className="mb-2 flex flex-wrap gap-1.5">
          {members.map((m) => (
            <li key={m.id} className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-gray-50 px-2 py-0.5 text-xs text-gray-700">
              {m.full_name}
              <Badge className="border-0 bg-white font-normal text-gray-500">{DEAL_MEMBER_ROLE_LABELS[m.role]}</Badge>
              {Number(m.split_percent) > 0 ? <span className="text-gray-400">{Number(m.split_percent)}%</span> : null}
              <button type="button" className="text-gray-400 hover:text-red-600" onClick={() => removeMutation.mutate(m.id)} title="Keluarkan"><X className="h-3 w-3" /></button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Select value={userId || "none"} onValueChange={(v) => setUserId(v === "none" ? "" : v)}>
          <SelectTrigger className="h-8 w-48 text-xs"><SelectValue placeholder="Pilih anggota" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">— pilih user —</SelectItem>
            {candidates.map((o) => <SelectItem key={o.id} value={o.id}>{o.full_name} · {o.role}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={role} onValueChange={(v) => setRole(v as DealMember["role"])}>
          <SelectTrigger className="h-8 w-40 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {(Object.keys(DEAL_MEMBER_ROLE_LABELS) as DealMember["role"][]).filter((r) => r !== "owner").map((r) => <SelectItem key={r} value={r}>{DEAL_MEMBER_ROLE_LABELS[r]}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button type="button" size="sm" variant="outline" className="h-8 text-xs" disabled={!userId || addMutation.isPending} onClick={() => { addMutation.mutate({ user_id: userId, role }); setUserId(""); }}>
          Tambah
        </Button>
      </div>
    </div>
  );
}
