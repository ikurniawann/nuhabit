"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Hourglass, Layers, Search, SlidersHorizontal, Wallet } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Field, TableNote, TEXTAREA } from "@/features/crm/engagement/components/shared";
import { ENTRY_LABELS, angka, entryDelta, rupiah, signedRupiah, tanggal, waktu, walletApi, type WalletEntry } from "../api";

const memberKey = (id: string) => ["wallet", "member", id];
const NOT_REVERSIBLE = new Set(["reversal", "topup_refund"]);

type Correction = { kind: "adjust" } | { kind: "reverse"; entry: WalletEntry } | { kind: "refund"; entry: WalletEntry };

/** POS → Member → Dompet Member: saldo per lot, riwayat, dan koreksi admin. */
export function WalletPage() {
  const router = useRouter();
  const params = useSearchParams();
  const memberId = params.get("member");
  const [term, setTerm] = useState("");
  const [debounced, setDebounced] = useState("");
  const [correction, setCorrection] = useState<Correction | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(term.trim()), 300);
    return () => clearTimeout(t);
  }, [term]);

  const results = useQuery({
    queryKey: ["wallet", "member-search", debounced],
    queryFn: () => walletApi.searchMembers(debounced),
    enabled: debounced.length >= 2,
  });
  const wallet = useQuery({
    queryKey: memberKey(memberId ?? ""),
    queryFn: () => walletApi.memberWallet(memberId as string),
    enabled: Boolean(memberId),
  });

  const pick = (id: string) => {
    setTerm("");
    router.replace(`?member=${id}`);
  };

  const data = wallet.data;
  const [now] = useState(() => Date.now());
  const expiringSoon = (data?.lots ?? []).filter(
    (l) => l.expires_at && new Date(l.expires_at).getTime() - now <= 30 * 86_400_000
  );

  return (
    <div className="space-y-4">
      <PageHeader
        kicker="POS · Member"
        title="Dompet Member"
        description="Lihat sisa saldo per lot dan masa berlakunya, lalu koreksi saldo bila perlu. Setiap koreksi wajib beralasan dan tercatat atas nama Anda."
        actions={
          data && (
            <Button onClick={() => setCorrection({ kind: "adjust" })}>
              <SlidersHorizontal /> Penyesuaian
            </Button>
          )
        }
      />

      <Card className="p-4">
        <label className="relative block">
          <Search className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Cari member dari nama atau nomor HP"
            className="pl-10"
          />
        </label>
        {debounced.length >= 2 && (
          <div className="mt-3 divide-y divide-border">
            {results.isLoading && <p className="py-3 text-sm text-muted-foreground">Mencari…</p>}
            {results.data?.length === 0 && <p className="py-3 text-sm text-muted-foreground">Member tidak ditemukan.</p>}
            {results.data?.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => pick(m.id)}
                className="flex w-full items-center justify-between gap-3 py-2.5 text-left text-sm hover:text-forest"
              >
                <span>
                  <span className="font-medium">{m.name ?? "Tanpa nama"}</span>
                  <span className="ml-2 font-mono text-xs text-muted-foreground">{m.phone}</span>
                </span>
                <span className="tabular-nums">{rupiah(m.balance)}</span>
              </button>
            ))}
          </div>
        )}
      </Card>

      {!memberId ? (
        <Card>
          <TableNote>Pilih member untuk melihat dompetnya.</TableNote>
        </Card>
      ) : wallet.isLoading ? (
        <Card>
          <TableNote>Memuat dompet…</TableNote>
        </Card>
      ) : wallet.error ? (
        <Card>
          <TableNote tone="danger">{wallet.error.message}</TableNote>
        </Card>
      ) : data ? (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
            <StatCard
              label={data.member.name ?? data.member.phone}
              value={rupiah(data.member.balance)}
              hint={data.member.phone}
              icon={<Wallet />}
              tone="ink"
            />
            <StatCard label="Lot aktif" value={angka(data.lots.length)} icon={<Layers />} />
            <StatCard
              label="Kedaluwarsa ≤ 30 hari"
              value={rupiah(expiringSoon.reduce((s, l) => s + l.remaining, 0))}
              icon={<Hourglass />}
              tone={expiringSoon.length ? "warning" : "default"}
            />
          </div>

          <Card className="py-0">
            <h2 className="px-5 pt-5 text-base font-semibold">Sisa saldo per lot</h2>
            {data.lots.length === 0 ? (
              <TableNote>Tidak ada lot bersisa.</TableNote>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Lot</TableHead>
                    <TableHead className="text-right">Sisa</TableHead>
                    <TableHead>Kedaluwarsa</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.lots.map((lot) => (
                    <TableRow key={lot.id}>
                      <TableCell>
                        {ENTRY_LABELS[lot.type] ?? lot.type}
                        <span className="block text-xs text-muted-foreground">
                          {waktu(lot.created_at)} · awal {rupiah(lot.amount)}
                        </span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{rupiah(lot.remaining)}</TableCell>
                      <TableCell>{tanggal(lot.expires_at)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>

          <Card className="py-0">
            <h2 className="px-5 pt-5 text-base font-semibold">Riwayat dompet</h2>
            <LedgerTable entries={data.entries} onCorrect={setCorrection} />
          </Card>
        </>
      ) : null}

      {correction && data && (
        <CorrectionDialog
          memberId={data.member.id}
          balance={data.member.balance}
          correction={correction}
          onClose={() => setCorrection(null)}
        />
      )}
    </div>
  );
}

function LedgerTable({ entries, onCorrect }: { entries: WalletEntry[]; onCorrect: (c: Correction) => void }) {
  if (entries.length === 0) return <TableNote>Belum ada transaksi.</TableNote>;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Transaksi</TableHead>
          <TableHead className="text-right">Mutasi</TableHead>
          <TableHead className="hidden text-right md:table-cell">Saldo</TableHead>
          <TableHead className="text-right">Koreksi</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {entries.map((e) => {
          const amount = entryDelta(e);
          const meta = e.metadata ?? {};
          const done = e.status == null || e.status === "completed";
          const locked = Boolean(meta.reversed_by || meta.refunded_at);
          return (
            <TableRow key={e.id} className={done ? undefined : "opacity-60"}>
              <TableCell className="max-w-[20rem] whitespace-normal">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-medium">{ENTRY_LABELS[e.type] ?? e.type}</span>
                  {!done && <Badge variant="muted">{e.status}</Badge>}
                  {Boolean(meta.reversed_by) && <Badge variant="outline">Dibatalkan</Badge>}
                  {Boolean(meta.refunded_at) && <Badge variant="outline">Direfund</Badge>}
                </div>
                <p className="text-xs text-muted-foreground">
                  {[waktu(e.created_at), e.notes, meta.actor_name ? `oleh ${meta.actor_name}` : null].filter(Boolean).join(" · ")}
                </p>
                {e.expires_at && <p className="text-xs text-muted-foreground">Berlaku s.d. {tanggal(e.expires_at)}</p>}
              </TableCell>
              <TableCell className={`text-right tabular-nums ${amount > 0 ? "text-success" : "text-danger"}`}>
                {signedRupiah(amount)}
              </TableCell>
              <TableCell className="hidden text-right tabular-nums md:table-cell">{rupiah(e.balance_after)}</TableCell>
              <TableCell className="text-right">
                {done && !locked && !NOT_REVERSIBLE.has(e.type) && (
                  <div className="flex justify-end gap-1">
                    {e.type === "topup" && e.payment_method !== "foc" && (
                      <Button variant="ghost" size="sm" onClick={() => onCorrect({ kind: "refund", entry: e })}>
                        Refund
                      </Button>
                    )}
                    <Button variant="ghost" size="sm" className="text-danger" onClick={() => onCorrect({ kind: "reverse", entry: e })}>
                      Batalkan
                    </Button>
                  </div>
                )}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

const REFUND_METHOD_LABELS: Record<string, string> = { cash: "Tunai", transfer: "Transfer bank", other: "Lainnya" };

function CorrectionDialog({
  memberId,
  balance,
  correction,
  onClose,
}: {
  memberId: string;
  balance: number;
  correction: Correction;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState("");
  const [direction, setDirection] = useState<1 | -1>(1);
  const [reason, setReason] = useState("");
  const [method, setMethod] = useState("transfer");
  const [reference, setReference] = useState("");

  const entry = correction.kind === "adjust" ? null : correction.entry;
  const isQris = entry?.payment_method === "qris";

  const submit = useMutation({
    mutationFn: () => {
      if (correction.kind === "adjust") return walletApi.adjust(memberId, direction * (Number(amount) || 0), reason);
      if (correction.kind === "reverse") return walletApi.reverse(correction.entry.id, reason);
      return walletApi.refund(correction.entry.id, { method, reference, reason });
    },
    onSuccess: () => {
      toast.success(
        correction.kind === "adjust" ? "Saldo disesuaikan" : correction.kind === "reverse" ? "Entri dibatalkan" : "Top-up direfund"
      );
      void queryClient.invalidateQueries({ queryKey: memberKey(memberId) });
      onClose();
    },
    onError: (error) => toast.error("Koreksi gagal", { description: error.message }),
  });

  const title =
    correction.kind === "adjust"
      ? "Penyesuaian saldo"
      : correction.kind === "reverse"
        ? `Batalkan ${ENTRY_LABELS[correction.entry.type] ?? correction.entry.type}`
        : "Refund top-up";
  const description =
    correction.kind === "adjust"
      ? `Saldo saat ini ${rupiah(balance)}. Penambahan menjadi lot baru dengan masa berlaku default.`
      : correction.kind === "reverse"
        ? `Entri ${signedRupiah(entryDelta(correction.entry))} dibalik sekali. Saldo tidak boleh menjadi minus.`
        : `Saldo top-up beserta bonus paketnya ditarik. Uang ${rupiah(Math.abs(correction.entry.amount))} dikembalikan di luar sistem.`;
  const valid = reason.trim().length >= 5 && (correction.kind !== "adjust" || Number(amount) > 0);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPanel>
        <DialogPanelForm
          onSubmit={(e) => {
            e.preventDefault();
            submit.mutate();
          }}
        >
          <DialogPanelHeader>
            <DialogPanelTitle>{title}</DialogPanelTitle>
            <DialogPanelDescription>{description}</DialogPanelDescription>
          </DialogPanelHeader>
          <DialogPanelBody className="grid gap-4">
            {correction.kind === "adjust" && (
              <>
                <div className="flex gap-2">
                  <Button type="button" variant={direction === 1 ? "ink" : "outline"} onClick={() => setDirection(1)}>
                    Tambah saldo
                  </Button>
                  <Button type="button" variant={direction === -1 ? "ink" : "outline"} onClick={() => setDirection(-1)}>
                    Kurangi saldo
                  </Button>
                </div>
                <Field label="Nominal (Rp)">
                  <Input type="number" min={1} step={500} value={amount} onChange={(e) => setAmount(e.target.value)} required />
                </Field>
              </>
            )}
            {correction.kind === "refund" && (
              <>
                {isQris && (
                  <p className="rounded-2xl bg-warning/10 px-4 py-3 text-sm text-warning">
                    QRIS Xendit tidak punya refund otomatis. Kembalikan uang secara manual, lalu catat buktinya di sini.
                  </p>
                )}
                <Field label="Metode pengembalian">
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(REFUND_METHOD_LABELS).map(([value, label]) => (
                      <Button
                        key={value}
                        type="button"
                        variant={method === value ? "ink" : "outline"}
                        size="sm"
                        onClick={() => setMethod(value)}
                      >
                        {label}
                      </Button>
                    ))}
                  </div>
                </Field>
                <Field label="Referensi" hint="Nomor transfer, nomor kwitansi, atau catatan bukti.">
                  <Input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={100} />
                </Field>
              </>
            )}
            <Field label="Alasan" hint="Wajib, minimal 5 karakter. Tersimpan di riwayat bersama nama Anda.">
              <textarea className={TEXTAREA} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
            </Field>
          </DialogPanelBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Batal
            </Button>
            <Button type="submit" variant={correction.kind === "adjust" ? "default" : "destructive"} disabled={!valid || submit.isPending}>
              {correction.kind === "adjust" ? "Simpan penyesuaian" : correction.kind === "reverse" ? "Batalkan entri" : "Refund top-up"}
            </Button>
          </DialogFooter>
        </DialogPanelForm>
      </DialogPanel>
    </Dialog>
  );
}
