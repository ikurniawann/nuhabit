"use client";

import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { toast } from "sonner";
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
import { Textarea } from "@/components/ui/textarea";
import { useCan } from "@/components/iam/iam-access-provider";
import { KIND_LABEL, type Clash, type EventConflictError } from "../api";

/** Sebut setiap peringatan irisan kelas (kapasitas cabang) lewat toast. */
export function toastWarnings(warnings: Clash[] | undefined) {
  if (!warnings?.length) return;
  toast.warning(warnings.length === 1 ? "Beririsan dengan kelas di cabang yang sama" : `Beririsan dengan ${warnings.length} kelas di cabang yang sama`, {
    description: warnings.map((w) => w.message).join(" · "),
  });
}

function ClashList({ items }: { items: Clash[] }) {
  return (
    <ul className="space-y-2">
      {items.map((c) => (
        <li key={`${c.kind}-${c.id}-${c.reason}`} className="rounded-2xl bg-surface px-4 py-3 text-sm">
          <p className="font-medium">
            {KIND_LABEL[c.kind]} · {c.title}
          </p>
          <p className="text-muted-foreground">{c.message}</p>
        </li>
      ))}
    </ul>
  );
}

/**
 * Simpan ditolak karena bentrok ruangan atau coach. Staf dengan izin
 * mengubah menu event boleh tetap menyimpan dengan alasan yang dicatat.
 */
export function ConflictDialog({
  conflict,
  menu,
  saving,
  onClose,
  onOverride,
}: {
  conflict: EventConflictError | null;
  /** Menu IAM yang izin "update"-nya membuka tombol tetap simpan. */
  menu: string;
  saving: boolean;
  onClose: () => void;
  onOverride: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const canOverride = useCan(menu, "update");
  return (
    <Dialog open={conflict !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogPanel size="sm">
        <DialogPanelHeader>
          <DialogPanelTitle className="flex items-center gap-2">
            <AlertTriangle className="size-5 text-warning" /> Jadwal bentrok
          </DialogPanelTitle>
          <DialogPanelDescription>
            Waktu event beririsan dengan agenda lain di ruangan atau coach yang sama. Ubah jam, ruangan, atau coach; atau tetap
            simpan dengan alasan yang dicatat.
          </DialogPanelDescription>
        </DialogPanelHeader>
        <DialogPanelBody className="space-y-4">
          <ClashList items={conflict?.blocking ?? []} />
          {conflict && conflict.warnings.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Juga beririsan dengan kelas</p>
              <ClashList items={conflict.warnings} />
            </div>
          )}
          {canOverride ? (
            <label className="flex flex-col">
              <span className="mb-1.5 text-sm font-medium">Alasan tetap simpan</span>
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Mis. kelas dipindah ke lapangan, sudah disepakati dengan coach."
                maxLength={500}
              />
            </label>
          ) : (
            <p className="text-sm text-muted-foreground">Butuh izin mengubah event untuk tetap menyimpan jadwal yang bentrok.</p>
          )}
        </DialogPanelBody>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Ubah jadwal
          </Button>
          {canOverride && (
            <Button type="button" variant="ink" disabled={reason.trim().length < 5 || saving} onClick={() => onOverride(reason.trim())}>
              Tetap simpan
            </Button>
          )}
        </DialogFooter>
      </DialogPanel>
    </Dialog>
  );
}
