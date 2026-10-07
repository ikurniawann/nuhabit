"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { TableNote } from "@/features/crm/engagement/components/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { SchemeRow } from "@/lib/gym/incentive-server";
import { formatRupiah } from "@/lib/format";
import { incentivesApi } from "../api";
import { useRefreshAll, useSchemes } from "../queries";
import { SchemeDialog } from "./scheme-dialog";

/** Skema honor: satu default organisasi + skema khusus per coach. */
export function SchemesTab() {
  const schemes = useSchemes();
  const refresh = useRefreshAll();
  const [editing, setEditing] = useState<SchemeRow | "new" | null>(null);
  const remove = useMutation({
    mutationFn: (id: string) => incentivesApi.deleteScheme(id),
    onSuccess: () => {
      toast.success("Skema coach dihapus", { description: "Coach kembali memakai skema default." });
      refresh();
    },
    onError: (error) => toast.error("Skema gagal dihapus", { description: error.message }),
  });

  const data = schemes.data;
  const classTypeName = (id: string) => data?.class_types.find((c) => c.id === id)?.name ?? "Jenis kelas";
  // Coach yang sudah punya skema sendiri tidak bisa dipilih lagi, kecuali skema yang sedang diubah.
  const editingCoachId = editing && editing !== "new" ? editing.coachId : null;
  const coachOptions = (data?.coaches ?? []).filter(
    (c) => c.id === editingCoachId || !data?.schemes.some((s) => s.coachId === c.id)
  );

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button onClick={() => setEditing("new")}>
          <Plus /> Skema khusus coach
        </Button>
      </div>
      <Card className="py-0">
        {schemes.isLoading ? (
          <TableNote>Memuat skema…</TableNote>
        ) : schemes.error ? (
          <TableNote tone="danger">{schemes.error.message}</TableNote>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Skema</TableHead>
                <TableHead className="text-right">Honor sesi</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Per peserta</TableHead>
                <TableHead className="hidden text-right md:table-cell">Bonus penuh</TableHead>
                <TableHead className="hidden text-right md:table-cell">No-show</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(data?.schemes ?? []).map((s) => (
                <TableRow key={s.id} className={s.isActive ? undefined : "opacity-60"}>
                  <TableCell className="max-w-[18rem] whitespace-normal">
                    <p className="font-medium">
                      {s.name} {s.isDefault && <Badge variant="ink">Default</Badge>}
                      {!s.isActive && <span className="ml-1 text-xs text-muted-foreground">nonaktif</span>}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {s.isDefault ? "Semua coach tanpa skema sendiri" : s.coachName}
                      {s.rates.length > 0 && ` · tarif khusus: ${s.rates.map((r) => classTypeName(r.classTypeId)).join(", ")}`}
                    </p>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatRupiah(s.sessionFeeIdr)}</TableCell>
                  <TableCell className="hidden text-right tabular-nums sm:table-cell">{formatRupiah(s.perAttendeeIdr)}</TableCell>
                  <TableCell className="hidden text-right tabular-nums md:table-cell">
                    {formatRupiah(s.fullClassBonusIdr)}
                    <span className="block text-xs text-muted-foreground">≥ {s.fullClassThresholdPercent}% kapasitas</span>
                  </TableCell>
                  <TableCell className="hidden text-right tabular-nums md:table-cell">
                    {s.noShowPenaltyIdr > 0 ? `− ${formatRupiah(s.noShowPenaltyIdr)}` : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => setEditing(s)}>
                        Ubah
                      </Button>
                      {!s.isDefault && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-danger"
                          aria-label={`Hapus skema ${s.name}`}
                          disabled={remove.isPending}
                          onClick={() => remove.mutate(s.id)}
                        >
                          <Trash2 />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
      {editing && data && (
        <SchemeDialog
          scheme={editing === "new" ? null : editing}
          coaches={coachOptions}
          classTypes={data.class_types}
          onClose={() => setEditing(null)}
          onSaved={refresh}
        />
      )}
    </div>
  );
}
