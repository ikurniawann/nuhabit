"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Banknote, CircleAlert } from "lucide-react";
import { toast } from "sonner";
import { Field, TableNote } from "@/features/crm/engagement/components/shared";
import { SELECT } from "@/features/gym/shared";
import { Can } from "@/components/iam/can";
import { useCan } from "@/components/iam/iam-access-provider";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatNumber, formatRupiah } from "@/lib/format";
import {
  CHANNEL_LABELS,
  COMMISSION_STATUS_LABELS,
  COMMISSION_STATUS_VARIANT,
  commissionApi,
  formatPercent,
  incidentLabel,
  METHOD_LABELS,
  ROLE_LABELS,
  type CommissionLine,
  type CommissionMonth,
  type PaymentMethod,
} from "../commission";
import { monthLabel } from "./shared";

export const commissionKeys = {
  all: ["gym", "incentives", "commission"] as const,
  months: (month: string) => ["gym", "incentives", "commission", "months", month] as const,
  settings: ["gym", "incentives", "commission", "settings"] as const,
};

/** Bagi hasil per cabang satu bulan: pool, porsi tiap coach, draf, persetujuan, dan pembayaran per coach. */
export function CommissionTab({ month, onOpenSettings }: { month: string; onOpenSettings: () => void }) {
  const query = useQuery({ queryKey: commissionKeys.months(month), queryFn: () => commissionApi.months(month) });
  const months = query.data ?? [];
  const active = months.filter((m) => m.settings || m.lines.length > 0);
  const inactive = months.filter((m) => !m.settings && m.lines.length === 0);

  if (query.isLoading) return <TableNote>Menghitung bagi hasil…</TableNote>;
  if (query.error) return <TableNote tone="danger">{query.error.message}</TableNote>;

  return (
    <div className="space-y-4">
      {active.length === 0 ? (
        <Card className="space-y-3 p-5">
          <p className="text-sm text-muted-foreground">
            Belum ada cabang dengan skema bagi hasil aktif. Aktifkan skema default atau buat skema per cabang.
          </p>
          <Button variant="outline" size="sm" onClick={onOpenSettings}>
            Atur skema bagi hasil
          </Button>
        </Card>
      ) : (
        active.map((m) => <BranchMonth key={m.branchId} data={m} />)
      )}
      {inactive.length > 0 && active.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Tanpa skema aktif: {inactive.map((m) => m.branchName).join(", ")}.{" "}
          <button type="button" className="font-medium text-forest underline-offset-4 hover:underline" onClick={onOpenSettings}>
            Atur skema
          </button>
        </p>
      )}
    </div>
  );
}

function BranchMonth({ data }: { data: CommissionMonth }) {
  const queryClient = useQueryClient();
  const [paying, setPaying] = useState<CommissionLine | null>(null);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: commissionKeys.months(data.periodMonth) });
  const act = useMutation({
    mutationFn: (action: "draft" | "approve") => commissionApi.act(data.branchId, data.periodMonth, action),
    onSuccess: (_, action) => {
      toast.success(action === "approve" ? "Bagi hasil disetujui dan dijurnal" : "Draf bagi hasil disimpan", {
        description: `${data.branchName} · ${monthLabel(data.periodMonth)}`,
      });
      refresh();
    },
    onError: (error) => toast.error("Bagi hasil gagal diproses", { description: error.message }),
  });
  const locked = data.status === "approved" || data.status === "paid";
  const canPay = useCan("gym.incentives", "update");

  return (
    <Card className="space-y-4 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold">{data.branchName}</h3>
            <Badge variant={COMMISSION_STATUS_VARIANT[data.status]}>{COMMISSION_STATUS_LABELS[data.status]}</Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            {data.schemeName ?? "Tanpa skema"}
            {data.settings &&
              ` · ${formatPercent(data.settings.classPoolPercent)} kelas + ${formatPercent(data.settings.ptPoolPercent)} PT · ${CHANNEL_LABELS[data.settings.payoutChannel]}`}
            {data.approvedAt && ` · disetujui ${formatDate(data.approvedAt)}`}
          </p>
        </div>
        {!locked && data.settings && (
          <div className="flex flex-wrap gap-2">
            <Can menu="gym.incentives" action="create">
              <Button size="sm" variant="outline" disabled={act.isPending} onClick={() => act.mutate("draft")}>
                Simpan draf
              </Button>
            </Can>
            <Can menu="gym.incentives" action="update">
              <Button
                size="sm"
                disabled={act.isPending || !data.monthOver || data.overAllocated}
                onClick={() => act.mutate("approve")}
              >
                Setujui
              </Button>
            </Can>
          </div>
        )}
      </div>

      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 lg:grid-cols-6">
        <Figure label="Pendapatan kelas" value={formatRupiah(data.classRevenueIdr)} />
        <Figure label="Pendapatan PT" value={formatRupiah(data.ptRevenueIdr)} />
        <Figure label="Pool" value={formatRupiah(data.totalPoolIdr)} strong />
        <Figure label="Porsi terpakai" value={formatPercent(data.allocatedPercent)} danger={data.overAllocated} />
        <Figure label="Dibayar ke coach" value={formatRupiah(data.allocatedIdr)} />
        <Figure label="Tetap di perusahaan" value={formatRupiah(data.retainedIdr)} />
      </dl>

      {!locked && (data.overAllocated || !data.monthOver) && (
        <p className="flex items-start gap-2 rounded-2xl bg-surface px-4 py-3 text-xs text-muted-foreground">
          <CircleAlert className="mt-0.5 size-4 shrink-0" />
          {data.overAllocated
            ? "Total porsi coach melebihi 100% pool. Turunkan porsi peran atau override coach sebelum menyetujui."
            : "Bulan ini belum berakhir: angka masih mengikuti kelas dan pendapatan yang masuk. Persetujuan dibuka setelah bulan selesai."}
        </p>
      )}

      {data.lines.length === 0 ? (
        <p className="text-sm text-muted-foreground">Belum ada coach yang mengajar kelas atau PT selesai di cabang ini bulan ini.</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Coach</TableHead>
                <TableHead className="text-right">Porsi</TableHead>
                <TableHead className="hidden text-right md:table-cell">Kotor</TableHead>
                <TableHead className="hidden text-right md:table-cell">Potongan</TableHead>
                <TableHead className="text-right">Bersih</TableHead>
                <TableHead className="text-right">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.lines.map((l) => (
                <TableRow key={l.coachId}>
                  <TableCell className="whitespace-normal">
                    <p className="font-medium">{l.coachName}</p>
                    <p className="text-xs text-muted-foreground">
                      {ROLE_LABELS[l.role]} · {formatNumber(l.classSessions)} kelas
                      {l.ptSessions > 0 && ` + ${formatNumber(l.ptSessions)} PT`} · {formatNumber(l.attendees)} hadir
                    </p>
                    {l.attributionPercent < 100 && (
                      <p className="text-xs text-muted-foreground">
                        {formatPercent(l.attributionPercent)} sesinya di cabang ini ({l.classSessions + l.ptSessions} dari{" "}
                        {l.allSessions})
                      </p>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatPercent(l.sharePercent)}</TableCell>
                  <TableCell className="hidden text-right tabular-nums md:table-cell">{formatRupiah(l.grossIdr)}</TableCell>
                  <TableCell className="hidden text-right md:table-cell">
                    {l.deductionIdr > 0 ? (
                      <span className="tabular-nums text-danger" title={l.incidents.map((i) => `${incidentLabel(i.kind)} ${i.occurredOn}`).join("\n")}>
                        {formatRupiah(l.deductionIdr)} ({formatPercent(l.deductionPercent)})
                      </span>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                    {l.incidents.length > 0 && (
                      <span className="block text-xs text-muted-foreground">{l.incidents.length} pelanggaran</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{formatRupiah(l.amountIdr)}</TableCell>
                  <TableCell className="text-right">
                    {l.status === "paid" && locked ? (
                      <span className="flex flex-col items-end gap-0.5">
                        <Badge variant="success">Dibayar</Badge>
                        <span className="text-xs text-muted-foreground">
                          {l.paymentMethod ? METHOD_LABELS[l.paymentMethod] : "Tanpa nominal"}
                          {l.payrollPeriod && ` ${monthLabel(l.payrollPeriod)}`}
                          {l.paymentReference && ` · ${l.paymentReference}`}
                        </span>
                      </span>
                    ) : locked && canPay ? (
                      <Button size="sm" onClick={() => setPaying(l)}>
                        <Banknote /> Bayar
                      </Button>
                    ) : locked ? (
                      <Badge variant="outline">Belum dibayar</Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">Belum disetujui</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {paying && data.settings && (
        <PayLineDialog
          line={paying}
          month={data}
          onClose={() => setPaying(null)}
          onDone={refresh}
        />
      )}
    </Card>
  );
}

function Figure({ label, value, strong, danger }: { label: string; value: string; strong?: boolean; danger?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={`truncate tabular-nums ${strong ? "font-semibold" : ""} ${danger ? "text-danger" : ""}`}>{value}</dd>
    </div>
  );
}

function PayLineDialog({
  line,
  month,
  onClose,
  onDone,
}: {
  line: CommissionLine;
  month: CommissionMonth;
  onClose: () => void;
  onDone: () => void;
}) {
  const viaPayroll = month.settings?.payoutChannel === "payroll";
  const [method, setMethod] = useState<PaymentMethod>(viaPayroll ? "payroll" : "transfer");
  const [reference, setReference] = useState("");
  const pay = useMutation({
    mutationFn: () => commissionApi.payLine(line.id, method, reference.trim()),
    onSuccess: () => {
      toast.success(viaPayroll ? "Komisi masuk payroll" : "Komisi ditandai dibayar", { description: line.coachName });
      onDone();
      onClose();
    },
    onError: (error) => toast.error("Komisi gagal dibayar", { description: error.message }),
  });
  const needsReference = method === "transfer";

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPanel size="sm">
        <DialogPanelForm
          onSubmit={(e) => {
            e.preventDefault();
            pay.mutate();
          }}
        >
          <DialogPanelHeader>
            <DialogPanelTitle>Bayar komisi {line.coachName}</DialogPanelTitle>
            <DialogPanelDescription>
              {viaPayroll
                ? `${formatRupiah(line.amountIdr)} untuk ${monthLabel(month.periodMonth)} masuk slip gaji karyawan coach ini pada periode payroll yang belum diproses. Coach harus tertaut ke karyawan HRIS dengan struktur gaji aktif.`
                : `${formatRupiah(line.amountIdr)} untuk ${monthLabel(month.periodMonth)} dibayar di luar payroll dan dijurnal dari utang komisi ke kas atau bank.`}
            </DialogPanelDescription>
          </DialogPanelHeader>
          <DialogPanelBody>
            {!viaPayroll && (
              <Field label="Cara bayar">
                <select className={SELECT} value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
                  <option value="transfer">Transfer</option>
                  <option value="cash">Tunai</option>
                </select>
              </Field>
            )}
            <Field label={needsReference ? "Referensi transfer" : "Referensi (opsional)"}>
              <Input
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="TRF-BCA-1028-01"
                required={needsReference}
              />
            </Field>
          </DialogPanelBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Batal
            </Button>
            <Button type="submit" disabled={pay.isPending || (needsReference && !reference.trim())}>
              {viaPayroll ? "Masukkan ke payroll" : "Tandai dibayar"}
            </Button>
          </DialogFooter>
        </DialogPanelForm>
      </DialogPanel>
    </Dialog>
  );
}
