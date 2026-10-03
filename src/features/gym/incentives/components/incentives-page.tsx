"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { BadgeCheck, Banknote, CalendarCheck, FileText, Plus, Trash2, Wallet } from "lucide-react";
import { toast } from "sonner";
import { angka, rupiah, waktu } from "@/features/crm/engagement/api";
import { Field, TableNote } from "@/features/crm/engagement/components/shared";
import { SELECT } from "@/features/gym/training/components/shared";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PAYOUT_STATUS_LABELS, type CoachStatement, type PayoutAction, type PayoutStatus } from "@/lib/gym/incentive";
import type { CoachStatementView, SchemeRow } from "@/lib/gym/incentive-server";
import { currentMonth, incentivesApi, type NamedOption, type PayoutRow } from "../api";

const PAYOUT_VARIANT: Record<PayoutStatus, "outline" | "info" | "success" | "muted"> = {
  draft: "outline",
  approved: "info",
  paid: "success",
  void: "muted",
};

const keys = {
  statements: (month: string) => ["gym", "incentives", "statements", month],
  payouts: (month: string) => ["gym", "incentives", "payouts", month],
  schemes: ["gym", "incentives", "schemes"],
};

const monthLabel = (month: string) =>
  new Date(`${month}-01T00:00:00`).toLocaleDateString("id-ID", { month: "long", year: "numeric" });

/** Gym → Insentif Coach: statement bulanan per coach, payout, dan skema honor. */
export function IncentivesPage() {
  const [month, setMonth] = useState(currentMonth);
  const statements = useQuery({ queryKey: keys.statements(month), queryFn: () => incentivesApi.statements(month) });
  const payouts = useQuery({ queryKey: keys.payouts(month), queryFn: () => incentivesApi.payouts(month) });

  const rows = statements.data ?? [];
  const live = (payouts.data ?? []).filter((p) => p.status !== "void");
  const total = rows.reduce((sum, s) => sum + s.totals.totalIdr, 0);
  const sessions = rows.reduce((sum, s) => sum + s.totals.sessions, 0);
  const paid = live.filter((p) => p.status === "paid");
  const waiting = live.filter((p) => p.status === "draft" || p.status === "approved");

  return (
    <div className="space-y-4">
      <PageHeader
        kicker="Gym · Insentif"
        title="Insentif Coach"
        description="Honor coach dihitung dari kelas yang selesai: honor sesi, per peserta yang hadir, bonus kelas penuh, dikurangi no-show. Payout membekukan statement satu bulan."
        actions={
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Bulan</span>
            <Input
              type="month"
              value={month}
              onChange={(e) => e.target.value && setMonth(e.target.value)}
              className="w-44"
              aria-label="Bulan statement"
            />
          </label>
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-4">
        <StatCard label={`Honor ${monthLabel(month)}`} value={rupiah(total)} icon={<Wallet />} tone="ink" />
        <StatCard label="Kelas selesai" value={angka(sessions)} icon={<CalendarCheck />} />
        <StatCard
          label="Menunggu diproses"
          value={angka(waiting.length)}
          unit="payout"
          icon={<FileText />}
          tone={waiting.length ? "warning" : "default"}
        />
        <StatCard
          label="Sudah dibayar"
          value={rupiah(paid.reduce((sum, p) => sum + p.total_idr, 0))}
          hint={`${angka(paid.length)} payout`}
          icon={<BadgeCheck />}
          tone={paid.length ? "success" : "default"}
        />
      </div>

      <Tabs defaultValue="statements" className="w-full flex-col">
        <TabsList>
          <TabsTrigger value="statements">Statement</TabsTrigger>
          <TabsTrigger value="payouts">Payout</TabsTrigger>
          <TabsTrigger value="schemes">Skema honor</TabsTrigger>
        </TabsList>
        <TabsContent value="statements" className="mt-4">
          <StatementsTab month={month} query={statements} />
        </TabsContent>
        <TabsContent value="payouts" className="mt-4">
          <PayoutsTab month={month} query={payouts} />
        </TabsContent>
        <TabsContent value="schemes" className="mt-4">
          <SchemesTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ── Statement ───────────────────────────────────────────────────────── */

function StatementsTab({
  month,
  query,
}: {
  month: string;
  query: UseQueryResult<CoachStatementView[], Error>;
}) {
  const queryClient = useQueryClient();
  const [detail, setDetail] = useState<(CoachStatement & { coachName: string }) | null>(null);
  const create = useMutation({
    mutationFn: (coachId: string) => incentivesApi.createPayout(coachId, month),
    onSuccess: () => {
      toast.success("Payout draf dibuat", { description: "Statement bulan ini dibekukan. Setujui lalu bayar di tab Payout." });
      void queryClient.invalidateQueries({ queryKey: keys.statements(month) });
      void queryClient.invalidateQueries({ queryKey: keys.payouts(month) });
    },
    onError: (error) => toast.error("Payout gagal dibuat", { description: error.message }),
  });
  const rows = query.data ?? [];

  return (
    <Card className="py-0">
      {query.isLoading ? (
        <TableNote>Menghitung statement…</TableNote>
      ) : query.error ? (
        <TableNote tone="danger">{query.error.message}</TableNote>
      ) : rows.length === 0 ? (
        <TableNote>Belum ada coach aktif.</TableNote>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Coach</TableHead>
              <TableHead className="text-right">Kelas</TableHead>
              <TableHead className="hidden text-right md:table-cell">Hadir</TableHead>
              <TableHead className="hidden text-right md:table-cell">No-show</TableHead>
              <TableHead className="hidden text-right lg:table-cell">Bonus</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Payout</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((s) => (
              <TableRow key={s.coachId}>
                <TableCell>
                  <p className="font-medium">{s.coachName}</p>
                  <p className="text-xs text-muted-foreground">{s.schemeName}</p>
                </TableCell>
                <TableCell className="text-right tabular-nums">{angka(s.totals.sessions)}</TableCell>
                <TableCell className="hidden text-right tabular-nums md:table-cell">{angka(s.totals.attended)}</TableCell>
                <TableCell className="hidden text-right tabular-nums md:table-cell">
                  {s.totals.noShows > 0 ? <span className="text-warning">{angka(s.totals.noShows)}</span> : 0}
                </TableCell>
                <TableCell className="hidden text-right tabular-nums lg:table-cell">{rupiah(s.totals.bonusIdr)}</TableCell>
                <TableCell className="text-right font-semibold tabular-nums">{rupiah(s.totals.totalIdr)}</TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    <Button variant="ghost" size="sm" onClick={() => setDetail(s)} disabled={s.lines.length === 0}>
                      Rincian
                    </Button>
                    {s.payout ? (
                      <Badge variant={PAYOUT_VARIANT[s.payout.status]}>{PAYOUT_STATUS_LABELS[s.payout.status]}</Badge>
                    ) : (
                      <Button
                        size="sm"
                        variant="soft"
                        disabled={create.isPending || s.totals.sessions === 0}
                        onClick={() => create.mutate(s.coachId)}
                      >
                        <Plus /> Buat payout
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {detail && <StatementDialog title={`Rincian ${detail.coachName}`} statement={detail} onClose={() => setDetail(null)} />}
    </Card>
  );
}

function StatementDialog({ title, statement, onClose }: { title: string; statement: CoachStatement; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPanel size="xl">
        <DialogPanelHeader>
          <DialogPanelTitle>{title}</DialogPanelTitle>
          <DialogPanelDescription>
            {monthLabel(statement.periodMonth)} · {angka(statement.totals.sessions)} kelas · total {rupiah(statement.totals.totalIdr)}
          </DialogPanelDescription>
        </DialogPanelHeader>
        <DialogPanelBody className="px-0 py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Kelas</TableHead>
                <TableHead className="text-right">Hadir</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Honor sesi</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Peserta</TableHead>
                <TableHead className="hidden text-right md:table-cell">Bonus</TableHead>
                <TableHead className="hidden text-right md:table-cell">Potongan</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {statement.lines.map((line) => (
                <TableRow key={line.sessionId}>
                  <TableCell>
                    <p className="font-medium">{line.classTypeName}</p>
                    <p className="text-xs text-muted-foreground">{waktu(line.startsAt)}</p>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {line.attended}/{line.capacity}
                    {line.noShows > 0 && <span className="block text-xs text-warning">{line.noShows} no-show</span>}
                  </TableCell>
                  <TableCell className="hidden text-right tabular-nums sm:table-cell">{rupiah(line.sessionFeeIdr)}</TableCell>
                  <TableCell className="hidden text-right tabular-nums sm:table-cell">{rupiah(line.attendeeIdr)}</TableCell>
                  <TableCell className="hidden text-right tabular-nums md:table-cell">{rupiah(line.bonusIdr)}</TableCell>
                  <TableCell className="hidden text-right tabular-nums md:table-cell">
                    {line.penaltyIdr > 0 ? `− ${rupiah(line.penaltyIdr)}` : "—"}
                  </TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{rupiah(line.totalIdr)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </DialogPanelBody>
      </DialogPanel>
    </Dialog>
  );
}

/* ── Payout ──────────────────────────────────────────────────────────── */

function PayoutsTab({
  month,
  query,
}: {
  month: string;
  query: UseQueryResult<PayoutRow[], Error>;
}) {
  const queryClient = useQueryClient();
  const [acting, setActing] = useState<{ payout: PayoutRow; action: "pay" | "void" } | null>(null);
  const [viewing, setViewing] = useState<PayoutRow | null>(null);
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: keys.payouts(month) });
    void queryClient.invalidateQueries({ queryKey: keys.statements(month) });
  };
  const approve = useMutation({
    mutationFn: (id: string) => incentivesApi.actOnPayout(id, "approve"),
    onSuccess: () => {
      toast.success("Payout disetujui");
      refresh();
    },
    onError: (error) => toast.error("Payout gagal disetujui", { description: error.message }),
  });
  const rows = query.data ?? [];

  return (
    <Card className="py-0">
      {query.isLoading ? (
        <TableNote>Memuat payout…</TableNote>
      ) : query.error ? (
        <TableNote tone="danger">{query.error.message}</TableNote>
      ) : rows.length === 0 ? (
        <TableNote>Belum ada payout untuk {monthLabel(month)}. Buat dari tab Statement.</TableNote>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Coach</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="hidden sm:table-cell">Status</TableHead>
              <TableHead className="hidden lg:table-cell">Referensi / catatan</TableHead>
              <TableHead className="text-right">Aksi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((p) => (
              <TableRow key={p.id} className={p.status === "void" ? "opacity-60" : undefined}>
                <TableCell>
                  <p className="font-medium">{p.coach_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {angka(p.sessions)} kelas · dibuat {waktu(p.created_at)}
                  </p>
                </TableCell>
                <TableCell className="text-right font-semibold tabular-nums">{rupiah(p.total_idr)}</TableCell>
                <TableCell className="hidden sm:table-cell">
                  <Badge variant={PAYOUT_VARIANT[p.status]}>{PAYOUT_STATUS_LABELS[p.status]}</Badge>
                </TableCell>
                <TableCell className="hidden max-w-[16rem] whitespace-normal text-xs lg:table-cell">
                  {p.payment_reference && <span className="font-mono">{p.payment_reference}</span>}
                  {p.note && <span className="block text-muted-foreground">{p.note}</span>}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" size="sm" onClick={() => setViewing(p)}>
                      Rincian
                    </Button>
                    {p.status === "draft" && (
                      <Button size="sm" variant="soft" disabled={approve.isPending} onClick={() => approve.mutate(p.id)}>
                        Setujui
                      </Button>
                    )}
                    {p.status === "approved" && (
                      <Button size="sm" onClick={() => setActing({ payout: p, action: "pay" })}>
                        <Banknote /> Bayar
                      </Button>
                    )}
                    {(p.status === "draft" || p.status === "approved") && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-danger"
                        onClick={() => setActing({ payout: p, action: "void" })}
                      >
                        Void
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {acting && (
        <PayoutActionDialog
          payout={acting.payout}
          action={acting.action}
          onClose={() => setActing(null)}
          onDone={refresh}
        />
      )}
      {viewing && <FrozenStatementDialog payout={viewing} onClose={() => setViewing(null)} />}
    </Card>
  );
}

function FrozenStatementDialog({ payout, onClose }: { payout: PayoutRow; onClose: () => void }) {
  const detail = useQuery({ queryKey: ["gym", "incentives", "payout", payout.id], queryFn: () => incentivesApi.payout(payout.id) });
  if (!detail.data) return null;
  return <StatementDialog title={`Payout ${payout.coach_name}`} statement={detail.data.statement} onClose={onClose} />;
}

function PayoutActionDialog({
  payout,
  action,
  onClose,
  onDone,
}: {
  payout: PayoutRow;
  action: Extract<PayoutAction, "pay" | "void">;
  onClose: () => void;
  onDone: () => void;
}) {
  const [value, setValue] = useState("");
  const isPay = action === "pay";
  const submit = useMutation({
    mutationFn: () =>
      incentivesApi.actOnPayout(payout.id, action, isPay ? { payment_reference: value.trim() } : { note: value.trim() }),
    onSuccess: () => {
      toast.success(isPay ? "Payout ditandai dibayar" : "Payout dibatalkan");
      onDone();
      onClose();
    },
    onError: (error) => toast.error("Payout gagal diproses", { description: error.message }),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPanel size="sm">
        <DialogPanelForm
          onSubmit={(e) => {
            e.preventDefault();
            submit.mutate();
          }}
        >
          <DialogPanelHeader>
            <DialogPanelTitle>
              {isPay ? "Bayar" : "Void"} payout {payout.coach_name}
            </DialogPanelTitle>
            <DialogPanelDescription>
              {isPay
                ? `${rupiah(payout.total_idr)} untuk ${monthLabel(payout.month)}. Catat nomor transfer atau bukti bayar.`
                : "Payout yang di-void tidak bisa dipulihkan. Buat payout baru dari tab Statement bila perlu."}
            </DialogPanelDescription>
          </DialogPanelHeader>
          <DialogPanelBody>
            <Field label={isPay ? "Referensi pembayaran" : "Alasan"}>
              <Input
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={isPay ? "TRF-BCA-0925-01" : "Absensi dikoreksi"}
                required
                autoFocus
              />
            </Field>
          </DialogPanelBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Batal
            </Button>
            <Button type="submit" variant={isPay ? "default" : "destructive"} disabled={!value.trim() || submit.isPending}>
              {isPay ? "Tandai dibayar" : "Void payout"}
            </Button>
          </DialogFooter>
        </DialogPanelForm>
      </DialogPanel>
    </Dialog>
  );
}

/* ── Skema ───────────────────────────────────────────────────────────── */

function SchemesTab() {
  const queryClient = useQueryClient();
  const schemes = useQuery({ queryKey: keys.schemes, queryFn: incentivesApi.schemes });
  const [editing, setEditing] = useState<SchemeRow | "new" | null>(null);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["gym", "incentives"] });
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
                  <TableCell className="text-right tabular-nums">{rupiah(s.sessionFeeIdr)}</TableCell>
                  <TableCell className="hidden text-right tabular-nums sm:table-cell">{rupiah(s.perAttendeeIdr)}</TableCell>
                  <TableCell className="hidden text-right tabular-nums md:table-cell">
                    {rupiah(s.fullClassBonusIdr)}
                    <span className="block text-xs text-muted-foreground">≥ {s.fullClassThresholdPercent}% kapasitas</span>
                  </TableCell>
                  <TableCell className="hidden text-right tabular-nums md:table-cell">
                    {s.noShowPenaltyIdr > 0 ? `− ${rupiah(s.noShowPenaltyIdr)}` : "—"}
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
          coaches={data.coaches.filter(
            (c) => c.id === (editing !== "new" ? editing.coachId : null) || !data.schemes.some((s) => s.coachId === c.id)
          )}
          classTypes={data.class_types}
          onClose={() => setEditing(null)}
          onSaved={refresh}
        />
      )}
    </div>
  );
}

interface RateDraft {
  class_type_id: string;
  session_fee_idr: string;
  per_attendee_idr: string;
}

function SchemeDialog({
  scheme,
  coaches,
  classTypes,
  onClose,
  onSaved,
}: {
  scheme: SchemeRow | null;
  coaches: NamedOption[];
  classTypes: NamedOption[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const isDefault = scheme?.isDefault ?? false;
  const [form, setForm] = useState({
    name: scheme?.name ?? "",
    coach_id: scheme?.coachId ?? "",
    session_fee_idr: String(scheme?.sessionFeeIdr ?? 150_000),
    per_attendee_idr: String(scheme?.perAttendeeIdr ?? 15_000),
    full_class_bonus_idr: String(scheme?.fullClassBonusIdr ?? 50_000),
    full_class_threshold_percent: String(scheme?.fullClassThresholdPercent ?? 80),
    no_show_penalty_idr: String(scheme?.noShowPenaltyIdr ?? 0),
    is_active: scheme?.isActive ?? true,
  });
  const [rates, setRates] = useState<RateDraft[]>(
    (scheme?.rates ?? []).map((r) => ({
      class_type_id: r.classTypeId,
      session_fee_idr: String(r.sessionFeeIdr),
      per_attendee_idr: String(r.perAttendeeIdr),
    }))
  );
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((cur) => ({ ...cur, [key]: e.target.value }));
  const setRate = (index: number, patch: Partial<RateDraft>) =>
    setRates((cur) => cur.map((r, i) => (i === index ? { ...r, ...patch } : r)));

  const save = useMutation({
    mutationFn: () =>
      incentivesApi.saveScheme({
        id: scheme?.id,
        name: form.name.trim(),
        coach_id: isDefault ? null : form.coach_id,
        session_fee_idr: Number(form.session_fee_idr) || 0,
        per_attendee_idr: Number(form.per_attendee_idr) || 0,
        full_class_bonus_idr: Number(form.full_class_bonus_idr) || 0,
        full_class_threshold_percent: Number(form.full_class_threshold_percent) || 0,
        no_show_penalty_idr: Number(form.no_show_penalty_idr) || 0,
        is_active: form.is_active,
        rates: rates
          .filter((r) => r.class_type_id)
          .map((r) => ({
            class_type_id: r.class_type_id,
            session_fee_idr: Number(r.session_fee_idr) || 0,
            per_attendee_idr: Number(r.per_attendee_idr) || 0,
          })),
      }),
    onSuccess: () => {
      toast.success("Skema disimpan", { description: form.name });
      onSaved();
      onClose();
    },
    onError: (error) => toast.error("Skema gagal disimpan", { description: error.message }),
  });

  const usedTypes = rates.map((r) => r.class_type_id).filter(Boolean);
  const threshold = Number(form.full_class_threshold_percent);
  const valid =
    form.name.trim().length >= 2 &&
    (isDefault || form.coach_id !== "") &&
    threshold >= 0 &&
    threshold <= 100 &&
    new Set(usedTypes).size === usedTypes.length;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPanel size="lg">
        <DialogPanelForm
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <DialogPanelHeader>
            <DialogPanelTitle>{scheme ? `Ubah ${scheme.name}` : "Skema khusus coach"}</DialogPanelTitle>
            <DialogPanelDescription>
              Per kelas selesai: honor sesi + hadir × per peserta + bonus bila hadir mencapai ambang kapasitas, dikurangi
              no-show. Baris tidak pernah di bawah Rp 0.
            </DialogPanelDescription>
          </DialogPanelHeader>
          <DialogPanelBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Nama skema">
              <Input value={form.name} onChange={set("name")} placeholder="Skema Rizky" required />
            </Field>
            {isDefault ? (
              <Field label="Berlaku untuk">
                <Input value="Semua coach tanpa skema sendiri" disabled />
              </Field>
            ) : (
              <Field label="Coach">
                <select className={SELECT} value={form.coach_id} onChange={set("coach_id")} required>
                  <option value="">Pilih coach…</option>
                  {coaches.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <Field label="Honor per sesi (Rp)">
              <Input type="number" min={0} value={form.session_fee_idr} onChange={set("session_fee_idr")} />
            </Field>
            <Field label="Per peserta hadir (Rp)">
              <Input type="number" min={0} value={form.per_attendee_idr} onChange={set("per_attendee_idr")} />
            </Field>
            <Field label="Bonus kelas penuh (Rp)">
              <Input type="number" min={0} value={form.full_class_bonus_idr} onChange={set("full_class_bonus_idr")} />
            </Field>
            <Field label="Ambang kelas penuh (%)" hint="Hadir ÷ kapasitas.">
              <Input
                type="number"
                min={0}
                max={100}
                value={form.full_class_threshold_percent}
                onChange={set("full_class_threshold_percent")}
              />
            </Field>
            <Field label="Potongan per no-show (Rp)">
              <Input type="number" min={0} value={form.no_show_penalty_idr} onChange={set("no_show_penalty_idr")} />
            </Field>
            {!isDefault && (
              <label className="flex items-center gap-2 self-end pb-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4 accent-forest"
                  checked={form.is_active}
                  onChange={(e) => setForm((cur) => ({ ...cur, is_active: e.target.checked }))}
                />
                Aktif (nonaktif = coach memakai skema default)
              </label>
            )}

            <div className="space-y-2 sm:col-span-2">
              <p className="text-sm font-medium">Tarif per jenis kelas</p>
              <p className="text-xs text-muted-foreground">
                Mengganti honor sesi dan per peserta untuk jenis kelas tertentu, mis. Race Simulation yang lebih panjang.
              </p>
              {rates.map((rate, index) => (
                <div
                  key={index}
                  className="grid grid-cols-1 gap-2 rounded-2xl bg-surface-2 p-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto]"
                >
                  <select
                    className={SELECT}
                    value={rate.class_type_id}
                    aria-label="Jenis kelas"
                    onChange={(e) => setRate(index, { class_type_id: e.target.value })}
                  >
                    <option value="">Pilih jenis kelas…</option>
                    {classTypes.map((c) => (
                      <option key={c.id} value={c.id} disabled={c.id !== rate.class_type_id && usedTypes.includes(c.id)}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <Input
                    type="number"
                    min={0}
                    aria-label="Honor sesi"
                    value={rate.session_fee_idr}
                    onChange={(e) => setRate(index, { session_fee_idr: e.target.value })}
                  />
                  <Input
                    type="number"
                    min={0}
                    aria-label="Per peserta"
                    value={rate.per_attendee_idr}
                    onChange={(e) => setRate(index, { per_attendee_idr: e.target.value })}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-danger"
                    aria-label="Hapus tarif"
                    onClick={() => setRates((cur) => cur.filter((_, i) => i !== index))}
                  >
                    <Trash2 />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setRates((cur) => [
                    ...cur,
                    { class_type_id: "", session_fee_idr: form.session_fee_idr, per_attendee_idr: form.per_attendee_idr },
                  ])
                }
              >
                <Plus /> Tambah tarif
              </Button>
            </div>
          </DialogPanelBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Batal
            </Button>
            <Button type="submit" disabled={!valid || save.isPending}>
              Simpan skema
            </Button>
          </DialogFooter>
        </DialogPanelForm>
      </DialogPanel>
    </Dialog>
  );
}
