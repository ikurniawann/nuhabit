"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogFooter,
  DialogPanel,
  DialogPanelBody,
  DialogPanelDescription,
  DialogPanelForm,
  DialogPanelHeader,
  DialogPanelTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Field, TableNote } from "@/features/crm/engagement/components/shared";
import { useDebounced } from "@/features/gym/use-debounced";
import { formatDate, formatNumber } from "@/lib/format";
import { gymCreditsApi, type MemberCredits, type MemberHit } from "../api";
import { transferPicks } from "../transfer";

/**
 * Transfer kredit ke member lain. Staf memilih penerima lalu jumlah per lot;
 * lot penerima mengikuti paket (jenis kelas) dan tanggal kedaluwarsa lot asal.
 */
export function TransferDialog({ credits, onClose, onDone }: { credits: MemberCredits; onClose: () => void; onDone: () => void }) {
  const [q, setQ] = useState("");
  const [receiver, setReceiver] = useState<MemberHit | null>(null);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  // One key per dialog: a double submit or a retry moves the credits once.
  const [key] = useState(() => crypto.randomUUID());
  const term = useDebounced(q.trim());
  const hits = useQuery({
    queryKey: ["gym-credits", "search", term],
    queryFn: () => gymCreditsApi.searchMembers(term),
    enabled: term.length >= 2 && !receiver,
  });
  const lots = credits.lots.filter((l) => l.remaining > 0 && !l.expired);
  const picks = transferPicks(lots, amounts);
  const total = picks.ok ? picks.lots.reduce((sum, p) => sum + p.credits, 0) : 0;
  const cap = credits.transfer.monthly_cap;
  const capLeft = cap > 0 ? Math.max(0, cap - credits.transfer.sent_this_month) : null;

  const send = useMutation({
    mutationFn: () =>
      gymCreditsApi.transfer(credits.member.id, {
        to_customer_id: receiver!.id,
        lots: picks.ok ? picks.lots : [],
        note: note.trim(),
        idempotency_key: key,
      }),
    onSuccess: (res) => {
      toast.success("Kredit terkirim", {
        description: `${formatNumber(res.credits)} kredit ke ${receiver?.name ?? receiver?.phone}. Kedua member mendapat notifikasi.`,
      });
      onDone();
      onClose();
    },
    onError: (error) => toast.error("Transfer gagal", { description: error.message }),
  });
  const valid = !!receiver && picks.ok && total > 0 && (capLeft == null || total <= capLeft);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPanel size="md">
        <DialogPanelForm
          onSubmit={(e) => {
            e.preventDefault();
            send.mutate();
          }}
        >
          <DialogPanelHeader>
            <DialogPanelTitle>Transfer kredit dari {credits.member.name ?? "member"}</DialogPanelTitle>
            <DialogPanelDescription>
              Kredit pindah beserta masa berlaku dan jenis kelasnya. Tidak ada transaksi uang.
              {capLeft != null && ` Sisa batas bulan ini: ${formatNumber(capLeft)} kredit.`}
            </DialogPanelDescription>
          </DialogPanelHeader>
          <DialogPanelBody className="grid grid-cols-1 gap-4">
            {receiver ? (
              <div className="flex items-center justify-between gap-3 rounded-2xl bg-surface px-4 py-3">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{receiver.name ?? "Tanpa nama"}</span>
                  <span className="block truncate font-mono text-xs text-muted-foreground">{receiver.phone}</span>
                </span>
                <Button type="button" variant="ghost" size="sm" onClick={() => setReceiver(null)}>
                  Ganti
                </Button>
              </div>
            ) : (
              <Field label="Penerima">
                <div className="relative">
                  <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    className="pl-9"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Nama, telepon, atau email"
                    aria-label="Cari penerima"
                  />
                </div>
              </Field>
            )}
            {!receiver && term.length >= 2 && (
              <ReceiverList
                hits={(hits.data ?? []).filter((m) => m.id !== credits.member.id)}
                loading={hits.isLoading}
                error={hits.error?.message}
                onPick={setReceiver}
              />
            )}

            <div className="min-w-0">
              <p className="mb-1.5 text-sm font-medium">Kredit yang dikirim</p>
              {lots.length === 0 ? (
                <TableNote>Tidak ada kredit aktif untuk dikirim.</TableNote>
              ) : (
                <ul className="flex flex-col gap-2">
                  {lots.map((lot) => (
                    <li key={lot.id} className="flex items-center justify-between gap-3 rounded-2xl border px-3 py-2">
                      <span className="min-w-0">
                        <span className="block truncate text-sm">{lot.package_name ?? "Bonus / penyesuaian"}</span>
                        <span className="block text-xs text-muted-foreground">
                          Sisa {formatNumber(lot.remaining)} · s.d. {formatDate(lot.expires_at)}
                        </span>
                      </span>
                      <Input
                        type="number"
                        min={0}
                        max={lot.remaining}
                        step={1}
                        className="w-20 shrink-0"
                        value={amounts[lot.id] ?? ""}
                        onChange={(e) => setAmounts((prev) => ({ ...prev, [lot.id]: e.target.value }))}
                        placeholder="0"
                        aria-label={`Kredit dari ${lot.package_name ?? "lot bonus"}`}
                      />
                    </li>
                  ))}
                </ul>
              )}
              {!picks.ok && <p className="mt-1 text-xs text-danger">{picks.error}</p>}
            </div>

            <Field label="Catatan" hint="Opsional. Tampil di riwayat kedua member.">
              <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="Hadiah, pindah akun keluarga, dll." />
            </Field>
            <div className="rounded-2xl bg-surface px-4 py-3">
              <p className="text-xs text-muted-foreground">Total dikirim</p>
              <p className={cn("text-2xl font-bold tabular-nums", capLeft != null && total > capLeft && "text-danger")}>
                {formatNumber(total)} kredit
              </p>
            </div>
          </DialogPanelBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Batal
            </Button>
            <Button type="submit" disabled={!valid || send.isPending}>
              {send.isPending ? "Mengirim…" : "Kirim kredit"}
            </Button>
          </DialogFooter>
        </DialogPanelForm>
      </DialogPanel>
    </Dialog>
  );
}

function ReceiverList({
  hits,
  loading,
  error,
  onPick,
}: {
  hits: MemberHit[];
  loading: boolean;
  error?: string;
  onPick: (m: MemberHit) => void;
}) {
  if (loading) return <TableNote>Mencari…</TableNote>;
  if (error) return <TableNote tone="danger">{error}</TableNote>;
  if (hits.length === 0) return <TableNote>Member tidak ditemukan.</TableNote>;
  return (
    <ul className="flex max-h-56 flex-col overflow-y-auto rounded-2xl border">
      {hits.map((m) => (
        <li key={m.id}>
          <button
            type="button"
            disabled={!m.is_active}
            onClick={() => onPick(m)}
            className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-surface disabled:opacity-50"
          >
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">{m.name ?? "Tanpa nama"}</span>
              <span className="block truncate font-mono text-xs text-muted-foreground">{m.phone}</span>
            </span>
            {m.is_active ? <Badge variant="muted">{formatNumber(m.balance)} kr</Badge> : <Badge variant="destructive">Nonaktif</Badge>}
          </button>
        </li>
      ))}
    </ul>
  );
}
