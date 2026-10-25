"use client";

import { useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { TableNote } from "@/features/crm/engagement/components/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogFooter,
  DialogPanel,
  DialogPanelBody,
  DialogPanelDescription,
  DialogPanelHeader,
  DialogPanelTitle,
} from "@/components/ui/dialog";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { rentangJam, tanggal, waktu } from "@/features/gym/scheduling/api";
import { COACH_LEAVE_KEYS, COVER_BADGE, type Candidate, type Cover } from "../api";

/** Satu sesi terdampak cuti: kelas atau PT, pengganti, status, dan aksi. */
export function CoverRow({ cover: c, actions }: { cover: Cover; actions?: ReactNode }) {
  const badge = COVER_BADGE[c.status];
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-surface-2 px-3 py-2">
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium">
          {c.kind === "pt" ? "PT · " : ""}
          {c.class_name}
        </span>
        <span className="block text-xs text-muted-foreground">
          {tanggal(c.starts_at, c.timezone)}, {rentangJam(c.starts_at, c.ends_at, c.timezone)} · {formatNumber(c.booked)} member
          {c.substitute_name && ` · pengganti ${c.substitute_name}`}
          {c.status === "requested" && c.respond_by && ` · jawab sebelum ${waktu(c.respond_by, c.timezone)}`}
          {c.cancel_reason && ` · ${c.cancel_reason}`}
          {c.note && ` · ${c.note}`}
        </span>
      </span>
      <span className="flex flex-wrap items-center gap-1.5">
        <Badge variant={badge.variant}>{badge.label}</Badge>
        {actions}
      </span>
    </li>
  );
}

/** Daftar sesi terdampak; kosong bila cuti tidak mengenai kelas atau PT. */
export function CoverList({ covers, actions }: { covers: Cover[]; actions?: (c: Cover) => ReactNode }) {
  if (covers.length === 0) return <p className="text-sm text-muted-foreground">Tidak ada kelas atau sesi PT di tanggal cuti.</p>;
  return (
    <ul className="flex flex-col gap-1.5">
      {covers.map((c) => (
        <CoverRow key={c.id} cover={c} actions={actions?.(c)} />
      ))}
    </ul>
  );
}

/**
 * Pilih pengganti dari coach yang bebas di jam sesi: tidak bentrok, tidak
 * cuti, dan untuk PT memegang jam PT. Yang pernah membawakan kelas ini dan
 * yang jadwalnya paling ringan minggu itu tampil lebih dulu.
 */
export function SubstituteDialog({
  cover,
  title,
  confirmLabel,
  load,
  pick,
  onClose,
  onDone,
}: {
  cover: Cover;
  title: string;
  confirmLabel: string;
  load: (coverId: string) => Promise<Candidate[]>;
  pick: (coverId: string, coachId: string) => Promise<Cover>;
  onClose: () => void;
  onDone: () => void;
}) {
  const [chosen, setChosen] = useState("");
  const list = useQuery({ queryKey: COACH_LEAVE_KEYS.candidates(cover.id), queryFn: () => load(cover.id) });
  const save = useMutation({
    mutationFn: () => pick(cover.id, chosen),
    onSuccess: () => {
      toast.success("Pengganti disimpan");
      onDone();
      onClose();
    },
    onError: (error) => toast.error("Gagal menyimpan pengganti", { description: error.message }),
  });
  const rows = list.data ?? [];

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogPanel size="md">
        <DialogPanelHeader>
          <DialogPanelTitle>{title}</DialogPanelTitle>
          <DialogPanelDescription>
            {cover.class_name} · {tanggal(cover.starts_at, cover.timezone)}, {rentangJam(cover.starts_at, cover.ends_at, cover.timezone)}
          </DialogPanelDescription>
        </DialogPanelHeader>
        <DialogPanelBody>
          {list.isLoading ? (
            <TableNote>Mencari coach yang bebas…</TableNote>
          ) : list.error ? (
            <TableNote tone="danger">{list.error.message}</TableNote>
          ) : rows.length === 0 ? (
            <TableNote>Tidak ada coach yang bebas di jam ini. Program Director bisa membatalkan sesinya.</TableNote>
          ) : (
            <ul className="flex flex-col gap-1.5" role="radiogroup" aria-label="Coach pengganti">
              {rows.map((c) => (
                <li key={c.coach_id}>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={chosen === c.coach_id}
                    onClick={() => setChosen(c.coach_id)}
                    className={cn(
                      "flex w-full items-center justify-between gap-2 rounded-2xl border px-3 py-2 text-left text-sm",
                      chosen === c.coach_id ? "border-forest bg-surface-2" : "border-border bg-card hover:bg-surface"
                    )}
                  >
                    <span className="font-medium">{c.name}</span>
                    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      {c.qualified && <Badge variant="success">Pernah membawakan</Badge>}
                      {formatNumber(c.week_load)} sesi minggu ini
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </DialogPanelBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Batal
          </Button>
          <Button disabled={!chosen || save.isPending} onClick={() => save.mutate()}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogPanel>
    </Dialog>
  );
}
