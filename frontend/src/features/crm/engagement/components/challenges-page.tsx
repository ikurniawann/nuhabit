"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Flag, Plus, Trophy, Users } from "lucide-react";
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
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { challengePhase, CHALLENGE_METRIC_LABEL } from "@/lib/crm/engagement/rules";
import { cn } from "@/lib/utils";
import { engagementApi, fromLocalInput, toLocalInput, waktu, type Challenge } from "../api";
import { formatNumber, formatRupiah } from "@/lib/format";
import { Field, TableNote, TEXTAREA } from "./shared";

const CHALLENGES_KEY = ["crm-engagement", "challenges"];

const PHASE_BADGE = {
  upcoming: { label: "Akan datang", variant: "outline" },
  running: { label: "Berjalan", variant: "info" },
  ended: { label: "Selesai", variant: "muted" },
} as const;

const formatTarget = (c: Pick<Challenge, "metric" | "target">) =>
  c.metric === "spend" ? formatRupiah(c.target) : `${formatNumber(c.target)} kunjungan`;

function rewardText(c: Pick<Challenge, "reward_xp" | "reward_ark_idr">): string {
  const parts = [c.reward_xp > 0 && `${formatNumber(c.reward_xp)} XP`, c.reward_ark_idr > 0 && `${formatRupiah(c.reward_ark_idr)} ARK`];
  return parts.filter(Boolean).join(" + ") || "Tanpa hadiah";
}

/** CRM → Engagement → Challenge: target kunjungan/belanja dalam jendela waktu. */
export function ChallengesPage() {
  const queryClient = useQueryClient();
  const challenges = useQuery({ queryKey: CHALLENGES_KEY, queryFn: engagementApi.challenges });
  const [editing, setEditing] = useState<Challenge | "new" | null>(null);
  const [viewing, setViewing] = useState<Challenge | null>(null);

  const rows = challenges.data ?? [];
  const now = new Date();
  const running = rows.filter((c) => c.is_active && challengePhase(c, now) === "running");

  return (
    <div className="space-y-4">
      <PageHeader
        kicker="CRM · Engagement"
        title="Challenge"
        description="Beri target kunjungan atau belanja dalam periode tertentu. Member ikut dari portal, dan hadiah XP atau ARK Coin masuk otomatis saat target tercapai."
        actions={
          <Button onClick={() => setEditing("new")}>
            <Plus /> Challenge baru
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
        <StatCard label="Sedang berjalan" value={formatNumber(running.length)} icon={<Flag />} tone="ink" />
        <StatCard
          label="Peserta aktif"
          value={formatNumber(running.reduce((s, c) => s + c.participant_count, 0))}
          unit="member"
          icon={<Users />}
        />
        <StatCard
          label="Sudah menuntaskan"
          value={formatNumber(rows.reduce((s, c) => s + c.completed_count, 0))}
          unit="member"
          icon={<Trophy />}
          tone="success"
        />
      </div>

      <Card className="py-0">
        {challenges.isLoading ? (
          <TableNote>Memuat challenge…</TableNote>
        ) : challenges.error ? (
          <TableNote tone="danger">{challenges.error.message}</TableNote>
        ) : rows.length === 0 ? (
          <TableNote>Belum ada challenge. Klik Challenge baru untuk membuat yang pertama.</TableNote>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Challenge</TableHead>
                <TableHead className="hidden md:table-cell">Periode</TableHead>
                <TableHead className="hidden lg:table-cell">Hadiah</TableHead>
                <TableHead className="text-right">Peserta</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((c) => {
                const phase = PHASE_BADGE[challengePhase(c, now)];
                return (
                  <TableRow key={c.id} className={c.is_active ? undefined : "opacity-60"}>
                    <TableCell className="max-w-[16rem] whitespace-normal">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{c.title}</span>
                        <Badge variant={c.is_active ? phase.variant : "muted"}>{c.is_active ? phase.label : "Nonaktif"}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">Target {formatTarget(c)}</p>
                    </TableCell>
                    <TableCell className="hidden text-xs md:table-cell">
                      {waktu(c.starts_at)} – {waktu(c.ends_at)}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">{rewardText(c)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatNumber(c.participant_count)}
                      <span className="block text-xs text-success">{formatNumber(c.completed_count)} tuntas</span>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => setViewing(c)}>
                          Peserta
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setEditing(c)}>
                          Ubah
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>

      {editing && (
        <ChallengeDialog
          challenge={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => void queryClient.invalidateQueries({ queryKey: CHALLENGES_KEY })}
        />
      )}
      {viewing && <ParticipantsDialog challenge={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}

function ChallengeDialog({
  challenge,
  onClose,
  onSaved,
}: {
  challenge: Challenge | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return {
      title: challenge?.title ?? "",
      description: challenge?.description ?? "",
      metric: challenge?.metric ?? ("visits" as Challenge["metric"]),
      target: String(challenge?.target ?? 5),
      starts_at: toLocalInput(challenge?.starts_at ?? start.toISOString()),
      ends_at: toLocalInput(challenge?.ends_at ?? new Date(start.getTime() + 30 * 86_400_000).toISOString()),
      reward_xp: String(challenge?.reward_xp ?? 100),
      reward_ark_idr: String(challenge?.reward_ark_idr ?? 0),
      is_active: challenge?.is_active ?? true,
    };
  });
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((cur) => ({ ...cur, [key]: e.target.value }));

  const save = useMutation({
    mutationFn: () =>
      engagementApi.saveChallenge({
        id: challenge?.id,
        title: form.title.trim(),
        description: form.description,
        metric: form.metric,
        target: Number(form.target) || 0,
        starts_at: fromLocalInput(form.starts_at),
        ends_at: fromLocalInput(form.ends_at),
        reward_xp: Number(form.reward_xp) || 0,
        reward_ark_idr: Number(form.reward_ark_idr) || 0,
        is_active: form.is_active,
      }),
    onSuccess: () => {
      toast.success("Challenge disimpan", { description: form.title });
      onSaved();
      onClose();
    },
    onError: (error) => toast.error("Challenge gagal disimpan", { description: error.message }),
  });

  const valid =
    form.title.trim().length >= 3 &&
    Number(form.target) > 0 &&
    new Date(form.ends_at).getTime() > new Date(form.starts_at).getTime();

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
            <DialogPanelTitle>{challenge ? `Ubah ${challenge.title}` : "Challenge baru"}</DialogPanelTitle>
            <DialogPanelDescription>
              Progres dihitung dari order lunas member dalam periode ini. Kunjungan dihitung satu per hari.
            </DialogPanelDescription>
          </DialogPanelHeader>
          <DialogPanelBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Judul" className="sm:col-span-2">
              <Input value={form.title} onChange={set("title")} placeholder="12 kelas di Oktober" required />
            </Field>
            <Field label="Deskripsi" className="sm:col-span-2">
              <textarea className={TEXTAREA} value={form.description} onChange={set("description")} />
            </Field>
            <div className="flex flex-col sm:col-span-2">
              <span className="mb-1.5 text-sm font-medium">Ukuran</span>
              <div className="inline-flex w-fit gap-1 rounded-full bg-surface p-1" role="radiogroup" aria-label="Ukuran">
                {(["visits", "spend"] as const).map((metric) => (
                  <button
                    key={metric}
                    type="button"
                    role="radio"
                    aria-checked={form.metric === metric}
                    onClick={() => setForm((cur) => ({ ...cur, metric }))}
                    className={cn(
                      "h-9 rounded-full px-4 text-sm font-semibold transition-colors",
                      form.metric === metric ? "bg-ink text-on-ink" : "text-body hover:bg-black/5"
                    )}
                  >
                    {CHALLENGE_METRIC_LABEL[metric]}
                  </button>
                ))}
              </div>
            </div>
            <Field label={form.metric === "spend" ? "Target belanja (Rp)" : "Target kunjungan"}>
              <Input type="number" min={1} value={form.target} onChange={set("target")} required />
            </Field>
            <div />
            <Field label="Mulai">
              <Input type="datetime-local" value={form.starts_at} onChange={set("starts_at")} required />
            </Field>
            <Field label="Berakhir">
              <Input type="datetime-local" value={form.ends_at} onChange={set("ends_at")} required />
            </Field>
            <Field label="Hadiah XP">
              <Input type="number" min={0} value={form.reward_xp} onChange={set("reward_xp")} />
            </Field>
            <Field label="Hadiah ARK Coin (nilai Rp)" hint="Masuk ke saldo sebagai transaksi bonus.">
              <Input type="number" min={0} value={form.reward_ark_idr} onChange={set("reward_ark_idr")} />
            </Field>
            <label className="flex items-center gap-3 sm:col-span-2">
              <Switch checked={form.is_active} onCheckedChange={(is_active) => setForm((cur) => ({ ...cur, is_active }))} />
              <span className="text-sm font-medium">Tampil di portal member</span>
            </label>
          </DialogPanelBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Batal
            </Button>
            <Button type="submit" disabled={!valid || save.isPending}>
              Simpan challenge
            </Button>
          </DialogFooter>
        </DialogPanelForm>
      </DialogPanel>
    </Dialog>
  );
}

function ParticipantsDialog({ challenge, onClose }: { challenge: Challenge; onClose: () => void }) {
  const detail = useQuery({
    queryKey: ["crm-engagement", "challenge", challenge.id],
    queryFn: () => engagementApi.challengeDetail(challenge.id),
  });
  const people = detail.data?.participants ?? [];

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPanel size="lg">
        <DialogPanelHeader>
          <DialogPanelTitle>Peserta {challenge.title}</DialogPanelTitle>
          <DialogPanelDescription>
            Target {formatTarget(challenge)} · hadiah {rewardText(challenge)}
          </DialogPanelDescription>
        </DialogPanelHeader>
        <DialogPanelBody className="px-0 py-0">
          {detail.isLoading ? (
            <TableNote>Memuat peserta…</TableNote>
          ) : people.length === 0 ? (
            <TableNote>Belum ada member yang ikut.</TableNote>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>Member</TableHead>
                  <TableHead>Progres</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {people.map((p, i) => (
                  <TableRow key={p.customer_id}>
                    <TableCell className="tabular-nums">{i + 1}</TableCell>
                    <TableCell>
                      <p className="font-medium">{p.name ?? "Member"}</p>
                      <p className="font-mono text-xs text-muted-foreground">{p.phone}</p>
                    </TableCell>
                    <TableCell className="min-w-[10rem]">
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="tabular-nums">
                          {challenge.metric === "spend" ? formatRupiah(p.value) : formatNumber(p.value)}
                        </span>
                        {p.rewarded_at ? (
                          <Badge variant="success">Hadiah terkirim</Badge>
                        ) : p.completed ? (
                          <Badge variant="info">Tuntas</Badge>
                        ) : null}
                      </div>
                      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface">
                        <i
                          className={cn("block h-full rounded-full", p.completed ? "bg-success" : "bg-ink")}
                          style={{ width: `${p.pct}%` }}
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </DialogPanelBody>
      </DialogPanel>
    </Dialog>
  );
}
