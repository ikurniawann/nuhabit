"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarPlus, Copy, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogPanel, DialogPanelBody, DialogPanelDescription, DialogPanelHeader, DialogPanelTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field, TableNote } from "@/features/crm/engagement/components/shared";
import { EVENTS_KEYS, eventsApi, type Option } from "../api";
import { SELECT_CLASS } from "./event-place-fields";

/**
 * Langganan ICS: satu URL bertoken per cabang yang bisa ditempel di Google
 * Calendar atau Outlook. Token hanya tampil sekali saat dibuat.
 */
export function FeedDialog({ branches, onClose }: { branches: Option[]; onClose: () => void }) {
  const queryClient = useQueryClient();
  const feeds = useQuery({ queryKey: EVENTS_KEYS.feeds, queryFn: eventsApi.feeds });
  const [branchId, setBranchId] = useState("");
  const [label, setLabel] = useState("");
  const [issued, setIssued] = useState<string | null>(null);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: EVENTS_KEYS.feeds });

  const create = useMutation({
    mutationFn: () => eventsApi.createFeed(branchId || null, label.trim()),
    onSuccess: (data) => {
      setIssued(data.url);
      refresh();
    },
    onError: (error) => toast.error("Langganan gagal dibuat", { description: error.message }),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => eventsApi.revokeFeed(id),
    onSuccess: () => {
      toast.success("Langganan dihentikan");
      refresh();
    },
    onError: (error) => toast.error("Langganan gagal dihentikan", { description: error.message }),
  });

  const copy = async () => {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued);
      toast.success("URL disalin");
    } catch {
      toast.error("Salin URL secara manual");
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPanel size="sm">
        <DialogPanelHeader>
          <DialogPanelTitle>Langganan kalender</DialogPanelTitle>
          <DialogPanelDescription>
            Tempel URL di Google Calendar (Tambah kalender lain, Dari URL) atau Outlook (Tambah kalender, Berlangganan dari web).
            Kalender diperbarui setiap jam.
          </DialogPanelDescription>
        </DialogPanelHeader>
        <DialogPanelBody className="space-y-4">
          {issued ? (
            <div className="space-y-2 rounded-2xl bg-surface p-4">
              <p className="text-sm font-medium">URL langganan baru. Simpan sekarang, URL ini tidak ditampilkan lagi.</p>
              <Input readOnly value={issued} onFocus={(e) => e.currentTarget.select()} className="font-mono text-xs" />
              <Button type="button" size="sm" variant="secondary" onClick={copy}>
                <Copy /> Salin URL
              </Button>
            </div>
          ) : (
            <form
              className="grid grid-cols-1 gap-3 rounded-2xl bg-surface p-4"
              onSubmit={(e) => {
                e.preventDefault();
                create.mutate();
              }}
            >
              <Field label="Cabang">
                <select className={SELECT_CLASS} value={branchId} onChange={(e) => setBranchId(e.target.value)}>
                  <option value="">Semua cabang</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Label" hint="Penanda untuk Anda sendiri, mis. Google pribadi.">
                <Input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} />
              </Field>
              <div>
                <Button type="submit" disabled={create.isPending}>
                  <CalendarPlus /> Buat URL langganan
                </Button>
              </div>
            </form>
          )}

          {feeds.isLoading ? (
            <TableNote>Memuat langganan…</TableNote>
          ) : (feeds.data ?? []).length === 0 ? (
            <TableNote>Belum ada langganan aktif.</TableNote>
          ) : (
            <ul className="divide-y divide-border">
              {(feeds.data ?? []).map((f) => (
                <li key={f.id} className="flex items-center gap-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{f.branch_name ?? "Semua cabang"}</p>
                    <p className="text-xs text-muted-foreground">{f.label || "Tanpa label"}</p>
                  </div>
                  <Button variant="ghost" size="icon-xs" aria-label="Hentikan langganan" onClick={() => revoke.mutate(f.id)}>
                    <Trash2 />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </DialogPanelBody>
      </DialogPanel>
    </Dialog>
  );
}
