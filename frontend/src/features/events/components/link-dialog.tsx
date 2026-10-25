"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Globe, Link2, Unlink } from "lucide-react";
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
import { Field, TableNote } from "@/features/crm/engagement/components/shared";
import { formatDateTime } from "@/lib/format";
import { EVENTS_KEYS, eventsApi, type EventSource } from "../api";
import { SELECT_CLASS } from "./event-place-fields";

/**
 * "Tautkan": satu event nyata dicatat sekali. Event CRM bisa ditautkan ke
 * event situs yang sudah ada atau diterbitkan sebagai draf situs; event
 * situs bisa menunjuk event CRM. Kalender menampilkan pasangan sebagai satu
 * entri dan checklist-nya digabung.
 */
export function LinkDialog({
  source,
  eventId,
  title,
  linkedId,
  onClose,
  onChanged,
}: {
  source: EventSource;
  eventId: string;
  title: string;
  /** Pasangan yang sudah tertaut (id di sisi lain), null bila belum. */
  linkedId: string | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const queryClient = useQueryClient();
  const other: EventSource = source === "crm" ? "site" : "crm";
  const candidates = useQuery({
    queryKey: EVENTS_KEYS.candidates(source),
    queryFn: () => eventsApi.linkCandidates(source),
    enabled: linkedId === null,
  });
  const [target, setTarget] = useState("");
  const done = (message: string) => {
    toast.success(message, { description: title });
    void queryClient.invalidateQueries({ queryKey: ["events"] });
    onChanged();
    onClose();
  };
  const fail = (error: Error) => toast.error("Tautan gagal diubah", { description: error.message });

  const link = useMutation({
    mutationFn: () => (source === "crm" ? eventsApi.link(eventId, target) : eventsApi.link(target, eventId)),
    onSuccess: () => done("Event ditautkan"),
    onError: fail,
  });
  const publish = useMutation({
    mutationFn: () => eventsApi.publishToSite(eventId),
    onSuccess: () => done("Draf event situs dibuat dan ditautkan"),
    onError: fail,
  });
  const unlink = useMutation({
    mutationFn: () => eventsApi.unlink(source === "crm" ? eventId : (linkedId as string)),
    onSuccess: () => done("Tautan dilepas"),
    onError: fail,
  });
  const busy = link.isPending || publish.isPending || unlink.isPending;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPanel size="sm">
        <DialogPanelHeader>
          <DialogPanelTitle>Tautkan {title}</DialogPanelTitle>
          <DialogPanelDescription>
            {source === "crm"
              ? "Hubungkan event member ini dengan halaman event di situs publik agar tidak dicatat dua kali."
              : "Tunjuk event member (CRM) yang sama dengan halaman situs ini. Pendaftaran dan checklist mengikuti event CRM."}
          </DialogPanelDescription>
        </DialogPanelHeader>
        <DialogPanelBody className="space-y-4">
          {linkedId !== null ? (
            <p className="rounded-2xl bg-surface px-4 py-3 text-sm">
              Sudah tertaut dengan {other === "site" ? "event situs" : "event member"}. Lepas tautan bila keduanya memang acara berbeda.
            </p>
          ) : candidates.isLoading ? (
            <TableNote>Memuat event…</TableNote>
          ) : (
            <Field label={other === "site" ? "Event situs" : "Event member (CRM)"} hint="Hanya event yang belum tertaut.">
              <select className={SELECT_CLASS} value={target} onChange={(e) => setTarget(e.target.value)}>
                <option value="">Pilih event</option>
                {(candidates.data ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title} · {formatDateTime(c.starts_at)}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </DialogPanelBody>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Tutup
          </Button>
          {linkedId !== null ? (
            <Button type="button" variant="ink" disabled={busy} onClick={() => unlink.mutate()}>
              <Unlink /> Lepas tautan
            </Button>
          ) : (
            <>
              {source === "crm" && (
                <Button type="button" variant="secondary" disabled={busy} onClick={() => publish.mutate()}>
                  <Globe /> Terbitkan ke situs
                </Button>
              )}
              <Button type="button" disabled={!target || busy} onClick={() => link.mutate()}>
                <Link2 /> Tautkan
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogPanel>
    </Dialog>
  );
}
