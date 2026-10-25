"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ExternalLink, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { PageHeader } from "@/components/ui/page-header";
import { Can } from "@/components/iam/can";
import { useCan } from "@/components/iam/iam-access-provider";
import { Field, TEXTAREA, TableNote } from "@/features/crm/engagement/components/shared";
import { memberHref } from "@/features/gym/members/member-link";
import { waktu } from "@/features/gym/scheduling/api";
import { SELECT } from "@/features/gym/shared";
import { formatDateTime } from "@/lib/format";
import {
  COMPLAINT_KEYS,
  MOVE_LABEL,
  PRIORITIES,
  PRIORITY_LABEL,
  SOURCE_LABEL,
  STATUS_LABEL,
  complaintsApi,
  reporterName,
  type ComplaintPriority,
  type ComplaintStatus,
  type TicketDetail,
  type TicketEvent,
} from "../api";
import { DeadlineText, PriorityBadge, StatusBadge } from "./ticket-bits";

const MENU = "gym.complaints";

/** Satu tiket keluhan: detail, pindah status, PIC, catatan internal, balasan ke member, riwayat. */
export function TicketDetailPage({ id }: { id: string }) {
  const detail = useQuery({ queryKey: COMPLAINT_KEYS.detail(id), queryFn: () => complaintsApi.detail(id) });
  const back = (
    <Link href="/dashboard/gym/complaints" className={buttonVariants({ variant: "ghost", size: "sm" })}>
      <ArrowLeft /> Semua tiket
    </Link>
  );
  if (detail.isLoading || detail.error || !detail.data) {
    return (
      <div className="space-y-4">
        {back}
        <Card>
          {detail.isLoading ? <TableNote>Memuat tiket…</TableNote> : <TableNote tone="danger">{detail.error?.message ?? "Tiket tidak ditemukan"}</TableNote>}
        </Card>
      </div>
    );
  }
  const t = detail.data;
  return (
    <div className="space-y-4">
      {back}
      <PageHeader
        kicker={`Keluhan · ${SOURCE_LABEL[t.source]}`}
        title={`${t.code} · ${t.title}`}
        description={`Dari ${reporterName(t)}, ${formatDateTime(t.created_at)}`}
        actions={<DeleteButton ticket={t} />}
      />
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={t.status} />
        <PriorityBadge priority={t.priority} />
        <Badge variant="outline">{t.category_label}</Badge>
        {t.escalated && <Badge variant="destructive">Dieskalasi</Badge>}
        {t.reopen_count > 0 && <Badge variant="warning">Dibuka lagi {t.reopen_count}x</Badge>}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-4">
          <Card className="space-y-3 p-5 text-sm">
            <h2 className="font-semibold">Keluhan</h2>
            <p className="whitespace-pre-wrap">{t.description ?? "Tanpa deskripsi."}</p>
          </Card>
          <Actions ticket={t} />
          <Card className="p-5">
            <h2 className="mb-3 text-sm font-semibold">Riwayat</h2>
            <ol className="space-y-3">
              {t.events.map((e) => (
                <EventRow key={e.id} event={e} />
              ))}
            </ol>
          </Card>
        </div>
        <div className="space-y-4">
          <Info ticket={t} />
          <EditCard ticket={t} />
        </div>
      </div>
    </div>
  );
}

function useTicketMutation<A>(id: string, fn: (a: A) => Promise<TicketDetail>, done?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (data) => {
      queryClient.setQueryData(COMPLAINT_KEYS.detail(id), data);
      void queryClient.invalidateQueries({ queryKey: ["gym-complaints", "list"] });
      if (done) toast.success(done);
    },
  });
}

function Actions({ ticket: t }: { ticket: TicketDetail }) {
  const canUpdate = useCan(MENU, "update");
  const [note, setNote] = useState("");
  const [reply, setReply] = useState(false);
  const move = useTicketMutation(t.id, ({ to }: { to: ComplaintStatus }) => complaintsApi.move(t.id, to, note), "Status diperbarui");
  const write = useTicketMutation(t.id, () => complaintsApi.note(t.id, note, reply), reply ? "Balasan terkirim ke member" : "Catatan disimpan");
  const error = move.error ?? write.error;
  if (!canUpdate) return null;

  return (
    <Card className="space-y-3 p-5">
      <h2 className="text-sm font-semibold">Tindak lanjut</h2>
      <Field
        label={reply ? "Balasan untuk member" : "Catatan"}
        hint={
          reply
            ? "Member membaca balasan ini di aplikasi."
            : "Catatan internal tidak terlihat member. Isi juga saat menandai selesai (terlihat member) atau membuka lagi."
        }
      >
        <textarea className={TEXTAREA} value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} />
      </Field>
      {t.customer_id && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="size-4" checked={reply} onChange={(e) => setReply(e.target.checked)} />
          Kirim sebagai balasan ke member
        </label>
      )}
      {error && <p className="text-sm text-danger">{error.message}</p>}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          disabled={!note.trim() || write.isPending}
          onClick={() => write.mutate(undefined, { onSuccess: () => setNote("") })}
        >
          {reply ? "Kirim balasan" : "Simpan catatan"}
        </Button>
        {t.next_statuses.map((to) => (
          <Button
            key={to}
            variant={to === "resolved" ? "default" : "outline"}
            disabled={move.isPending}
            onClick={() => move.mutate({ to }, { onSuccess: () => setNote("") })}
          >
            {MOVE_LABEL[to]}
          </Button>
        ))}
      </div>
    </Card>
  );
}

function Info({ ticket: t }: { ticket: TicketDetail }) {
  const canUpdate = useCan(MENU, "update");
  const options = useQuery({ queryKey: COMPLAINT_KEYS.options, queryFn: complaintsApi.options, enabled: canUpdate });
  const assign = useTicketMutation(t.id, (userId: string | null) => complaintsApi.assign(t.id, userId), "PIC diperbarui");
  const rows: [string, React.ReactNode][] = [
    ["Pelapor", t.customer_id ? <Link className="hover:underline" href={memberHref(t.customer_id)}>{t.member_name ?? "Member"}</Link> : reporterName(t)],
    ["Kontak", t.member_phone ?? t.contact_phone ?? "-"],
    ["Coach", t.coach_name ?? "-"],
    ["Kelas", t.session_name && t.session_starts_at ? `${t.session_name} · ${waktu(t.session_starts_at, t.timezone)}` : "-"],
    ["Cabang", t.branch_name ?? "-"],
    ["Batas respons", formatDateTime(t.respond_by)],
    ["Batas selesai", formatDateTime(t.resolve_by)],
    ["Respons pertama", formatDateTime(t.first_response_at)],
    ["Selesai", formatDateTime(t.resolved_at)],
    ["Dibuat oleh", t.created_by_name ?? (t.source === "member_app" ? "Member lewat aplikasi" : "-")],
  ];
  return (
    <Card className="space-y-3 p-5 text-sm">
      <p>
        <DeadlineText ticket={t} now={new Date()} />
      </p>
      <dl className="divide-y divide-border">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-3 py-2">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="text-right font-medium">{value}</dd>
          </div>
        ))}
      </dl>
      {t.conversation_id && (
        <Link href="/dashboard/crm/inbox" className={buttonVariants({ variant: "outline", size: "sm" })}>
          <ExternalLink /> Buka inbox WhatsApp
        </Link>
      )}
      <Field label="PIC">
        <select
          className={SELECT}
          disabled={!canUpdate || assign.isPending}
          value={t.owner_user_id ?? ""}
          onChange={(e) => assign.mutate(e.target.value || null)}
        >
          <option value="">Belum ada</option>
          {t.owner_user_id && !options.data?.staff.some((s) => s.id === t.owner_user_id) && <option value={t.owner_user_id}>{t.owner_name}</option>}
          {options.data?.staff.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </Field>
      {assign.error && <p className="text-danger">{assign.error.message}</p>}
    </Card>
  );
}

function EditCard({ ticket: t }: { ticket: TicketDetail }) {
  const canUpdate = useCan(MENU, "update");
  const options = useQuery({ queryKey: COMPLAINT_KEYS.options, queryFn: complaintsApi.options, enabled: canUpdate });
  const update = useTicketMutation(t.id, (patch: Parameters<typeof complaintsApi.update>[1]) => complaintsApi.update(t.id, patch), "Tiket diperbarui");
  if (!canUpdate || t.status === "confirmed") return null;
  return (
    <Card className="space-y-3 p-5">
      <h2 className="text-sm font-semibold">Ubah tiket</h2>
      <Field label="Kategori">
        <select className={SELECT} value={t.category} disabled={update.isPending} onChange={(e) => update.mutate({ category: e.target.value })}>
          {!options.data?.categories.some((c) => c.code === t.category) && <option value={t.category}>{t.category_label}</option>}
          {options.data?.categories.map((c) => (
            <option key={c.code} value={c.code}>
              {c.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Prioritas" hint="Mengubah prioritas menghitung ulang batas waktu.">
        <select
          className={SELECT}
          value={t.priority}
          disabled={update.isPending}
          onChange={(e) => update.mutate({ priority: e.target.value as ComplaintPriority })}
        >
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {PRIORITY_LABEL[p]}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Coach">
        <select
          className={SELECT}
          value={t.coach_id ?? ""}
          disabled={update.isPending}
          onChange={(e) => update.mutate(e.target.value ? { coach_id: e.target.value } : { clear: ["coach_id"] })}
        >
          <option value="">Tidak terkait coach</option>
          {t.coach_id && !options.data?.coaches.some((c) => c.id === t.coach_id) && <option value={t.coach_id}>{t.coach_name}</option>}
          {options.data?.coaches.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Cabang">
        <select
          className={SELECT}
          value={t.branch_id ?? ""}
          disabled={update.isPending}
          onChange={(e) => update.mutate(e.target.value ? { branch_id: e.target.value } : { clear: ["branch_id"] })}
        >
          <option value="">Tanpa cabang</option>
          {options.data?.branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </Field>
      {update.error && <p className="text-sm text-danger">{update.error.message}</p>}
    </Card>
  );
}

function DeleteButton({ ticket: t }: { ticket: TicketDetail }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const del = useMutation({
    mutationFn: () => complaintsApi.remove(t.id),
    onSuccess: () => {
      toast.success(`Tiket ${t.code} dihapus`);
      void queryClient.invalidateQueries({ queryKey: COMPLAINT_KEYS.all });
      router.push("/dashboard/gym/complaints");
    },
  });
  return (
    <Can menu={MENU} action="delete">
      <Button variant="ghost" onClick={() => setOpen(true)}>
        <Trash2 /> Hapus
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`Hapus tiket ${t.code}?`}
        description="Hanya untuk tiket salah input atau ganda. Riwayatnya ikut terhapus dan tidak bisa dikembalikan."
        confirmLabel="Hapus tiket"
        loading={del.isPending}
        onConfirm={() => del.mutate()}
      />
    </Can>
  );
}

const EVENT_LABEL: Record<TicketEvent["kind"], string> = {
  created: "Tiket dibuat",
  status: "Status",
  assign: "PIC",
  note: "Catatan internal",
  reply: "Balasan ke member",
  updated: "Diubah",
  escalated: "Eskalasi",
};

function EventRow({ event: e }: { event: TicketEvent }) {
  const label =
    e.kind === "status" && e.to_status
      ? `${e.from_status ? STATUS_LABEL[e.from_status] : ""} → ${STATUS_LABEL[e.to_status]}`
      : EVENT_LABEL[e.kind];
  const who = e.by_member ? `${e.actor_name ?? "Member"} (member)` : (e.actor_name ?? "Sistem");
  return (
    <li className={e.kind === "note" ? "rounded-2xl bg-warning-soft px-4 py-3 text-sm" : "border-l-2 border-border pl-4 text-sm"}>
      <p className="font-medium">
        {label}
        {e.is_public && e.kind !== "created" && <span className="ml-2 text-xs font-normal text-muted-foreground">terlihat member</span>}
      </p>
      {e.body && <p className="mt-0.5 whitespace-pre-wrap text-body">{e.body}</p>}
      <p className="mt-0.5 text-xs text-muted-foreground">
        {who} · {formatDateTime(e.created_at)}
      </p>
    </li>
  );
}
