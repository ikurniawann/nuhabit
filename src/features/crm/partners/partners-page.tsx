"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, KeyRound, Plug, Plus, RefreshCw, UserSearch } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
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
import { Field, TableNote } from "@/features/crm/engagement/components/shared";
import { crmFetch as call } from "../crm-fetch";
import { PARTNER_TYPE_LABELS, PARTNER_TYPES, PARTNER_XP_CAP, type PartnerType } from "@/lib/crm/partner-types";

interface Partner {
  id: string;
  code: string;
  name: string;
  partner_type: PartnerType;
  is_active: boolean;
  awards_xp: boolean;
  xp_per_event: number;
  has_secret: boolean;
  secret_rotated_at: string | null;
  event_count: number;
  processed_count: number;
  pending_count: number;
  xp_total: number;
  last_event_at: string | null;
}

interface PartnerEvent {
  id: string;
  external_event_id: string;
  event_type: string;
  customer_identifier: string | null;
  status: "pending" | "processed" | "unmatched" | "failed" | "ignored";
  xp_awarded: number;
  error_message: string | null;
  received_at: string;
  partner_name: string;
  member_name: string | null;
  member_phone: string | null;
}

const PARTNERS_KEY = ["crm", "partners"];
const EVENTS_KEY = ["crm", "partners", "events"];

const EVENT_BADGE: Record<PartnerEvent["status"], { label: string; variant: "success" | "warning" | "destructive" | "muted" | "outline" }> = {
  processed: { label: "Diproses", variant: "success" },
  unmatched: { label: "Belum cocok", variant: "warning" },
  failed: { label: "Gagal", variant: "destructive" },
  ignored: { label: "Diabaikan", variant: "muted" },
  pending: { label: "Menunggu", variant: "outline" },
};

const SELECT =
  "h-10 rounded-full border border-border bg-card px-4 text-sm text-foreground outline-none focus-visible:border-forest";

const waktu = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("id-ID", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Asia/Jakarta",
      })
    : "-";

/** CRM → Loyalty → Partner Loyalty: partner eksternal, secret, dan event masuk. */
export function PartnersPage() {
  const queryClient = useQueryClient();
  const partners = useQuery({ queryKey: PARTNERS_KEY, queryFn: () => call<Partner[]>("/api/crm/partners").then((r) => r.data) });
  const [creating, setCreating] = useState(false);
  const [secret, setSecret] = useState<{ code: string; secret: string } | null>(null);
  const [rotating, setRotating] = useState<Partner | null>(null);
  const [eventFilter, setEventFilter] = useState({ partner_id: "", status: "" });
  const [matching, setMatching] = useState<PartnerEvent | null>(null);

  const refresh = () => void queryClient.invalidateQueries({ queryKey: PARTNERS_KEY });
  const update = useMutation({
    mutationFn: (input: { id: string; patch: Record<string, unknown> }) =>
      call<{ id: string; secret?: string }>(`/api/crm/partners/${input.id}`, {
        method: "PATCH",
        body: JSON.stringify(input.patch),
      }),
    onSuccess: (result, input) => {
      if (result.data.secret) {
        const partner = partners.data?.find((p) => p.id === input.id);
        setSecret({ code: partner?.code ?? "", secret: result.data.secret });
        setRotating(null);
      }
      toast.success(result.message ?? "Partner diperbarui");
      refresh();
    },
    onError: (error) => toast.error("Partner gagal diperbarui", { description: error.message }),
  });

  const eventParams = new URLSearchParams(Object.entries(eventFilter).filter(([, v]) => v !== ""));
  const events = useQuery({
    queryKey: [...EVENTS_KEY, eventParams.toString()],
    queryFn: () => call<PartnerEvent[]>(`/api/crm/partners/events?${eventParams}`).then((r) => r.data),
  });
  const rematchAll = useMutation({
    mutationFn: () =>
      call<{ checked: number; matched: number }>("/api/crm/partners/events/rematch", {
        method: "POST",
        body: JSON.stringify({ mode: "auto", partner_id: eventFilter.partner_id || null }),
      }),
    onSuccess: (result) => {
      toast.success(result.message ?? "Pencocokan ulang selesai");
      void queryClient.invalidateQueries({ queryKey: PARTNERS_KEY });
    },
    onError: (error) => toast.error("Pencocokan ulang gagal", { description: error.message }),
  });

  const rows = partners.data ?? [];
  const pending = rows.reduce((sum, p) => sum + p.pending_count, 0);
  const xpTotal = rows.reduce((sum, p) => sum + p.xp_total, 0);
  const origin = typeof window === "undefined" ? "" : window.location.origin;

  return (
    <div className="space-y-4">
      <PageHeader
        kicker="CRM · Loyalty"
        title="Partner Loyalty"
        description="Photobooth, studio game, dan partner lain mengirim event bertanda tangan. Event dicocokkan ke member lewat email atau telepon; XP diberikan bila partner diizinkan."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus /> Partner baru
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
        <StatCard label="Partner aktif" value={rows.filter((p) => p.is_active).length} icon={<Plug />} tone="ink" />
        <StatCard label="Event belum cocok" value={pending.toLocaleString("id-ID")} tone={pending ? "warning" : "default"} />
        <StatCard label="XP dari partner" value={xpTotal.toLocaleString("id-ID")} unit="XP" />
      </div>

      <Card className="py-0">
        {partners.isLoading ? (
          <TableNote>Memuat partner…</TableNote>
        ) : partners.error ? (
          <TableNote tone="danger">{partners.error.message}</TableNote>
        ) : rows.length === 0 ? (
          <TableNote>Belum ada partner. Klik Partner baru untuk membuat kode dan secret.</TableNote>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Partner</TableHead>
                <TableHead className="hidden md:table-cell">Event</TableHead>
                <TableHead>Beri XP</TableHead>
                <TableHead className="text-right">Aktif</TableHead>
                <TableHead className="text-right">Secret</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((partner) => (
                <TableRow key={partner.id} className={partner.is_active ? undefined : "opacity-60"}>
                  <TableCell>
                    <p className="font-medium">{partner.name}</p>
                    <p className="font-mono text-xs text-muted-foreground">
                      {partner.code} · {PARTNER_TYPE_LABELS[partner.partner_type]}
                    </p>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <p className="tabular-nums">
                      {partner.processed_count} diproses
                      {partner.pending_count > 0 && <span className="text-warning"> · {partner.pending_count} tertunda</span>}
                    </p>
                    <p className="text-xs text-muted-foreground">Terakhir {waktu(partner.last_event_at)}</p>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={partner.awards_xp}
                        aria-label={`Beri XP untuk ${partner.name}`}
                        onCheckedChange={(next) => update.mutate({ id: partner.id, patch: { awards_xp: next } })}
                      />
                      <XpInput
                        value={partner.xp_per_event}
                        disabled={!partner.awards_xp}
                        onSave={(xp) => update.mutate({ id: partner.id, patch: { xp_per_event: xp } })}
                      />
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <Switch
                      checked={partner.is_active}
                      aria-label={`Aktifkan ${partner.name}`}
                      onCheckedChange={(next) => update.mutate({ id: partner.id, patch: { is_active: next } })}
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" onClick={() => setRotating(partner)}>
                      <KeyRound /> {partner.has_secret ? "Rotasi" : "Buat"}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <Card className="gap-3 px-5">
        <p className="text-sm font-semibold">Cara partner mengirim event</p>
        <pre className="overflow-x-auto rounded-2xl bg-surface-2 p-4 font-mono text-xs leading-relaxed">{`POST ${origin}/api/integrations/loyalty-events/<KODE>
X-Timestamp: <detik Unix, maks. selisih 5 menit>
X-Signature: sha256=<hex HMAC-SHA256(raw body, secret)>

{ "external_id": "sesi-123", "event_type": "photo_session",
  "email": "member@mail.com" | "phone": "0812…",
  "occurred_at": "2026-10-04T10:00:00+07:00", "payload": {} }`}</pre>
        <p className="text-xs text-muted-foreground">
          Kirim ulang dengan external_id yang sama aman: event dicatat sekali dan XP tidak dobel. XP per event maksimal{" "}
          {PARTNER_XP_CAP}.
        </p>
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-base font-semibold">Event masuk</h2>
        <select
          className={SELECT}
          aria-label="Partner"
          value={eventFilter.partner_id}
          onChange={(e) => setEventFilter((cur) => ({ ...cur, partner_id: e.target.value }))}
        >
          <option value="">Semua partner</option>
          {rows.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <select
          className={SELECT}
          aria-label="Status"
          value={eventFilter.status}
          onChange={(e) => setEventFilter((cur) => ({ ...cur, status: e.target.value }))}
        >
          <option value="">Semua status</option>
          {Object.entries(EVENT_BADGE).map(([value, { label }]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <Button variant="outline" disabled={rematchAll.isPending} onClick={() => rematchAll.mutate()}>
          <RefreshCw /> Cocokkan ulang
        </Button>
      </div>

      <Card className="py-0">
        {events.isLoading ? (
          <TableNote>Memuat event…</TableNote>
        ) : events.error ? (
          <TableNote tone="danger">{events.error.message}</TableNote>
        ) : (events.data ?? []).length === 0 ? (
          <TableNote>Belum ada event masuk.</TableNote>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Event</TableHead>
                <TableHead className="hidden md:table-cell">Dikirim untuk</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(events.data ?? []).map((event) => (
                <TableRow key={event.id}>
                  <TableCell>
                    <p className="font-medium">{event.event_type}</p>
                    <p className="text-xs text-muted-foreground">
                      {event.partner_name} · {event.external_event_id} · {waktu(event.received_at)}
                    </p>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <p>{event.member_name ?? <span className="text-muted-foreground">{event.customer_identifier ?? "-"}</span>}</p>
                    {event.member_name && <p className="text-xs text-muted-foreground">{event.member_phone}</p>}
                  </TableCell>
                  <TableCell>
                    <Badge variant={EVENT_BADGE[event.status].variant}>{EVENT_BADGE[event.status].label}</Badge>
                    {event.xp_awarded > 0 && <span className="ml-2 text-xs text-success">+{event.xp_awarded} XP</span>}
                    {event.error_message && <p className="mt-1 text-xs text-danger">{event.error_message}</p>}
                  </TableCell>
                  <TableCell className="text-right">
                    {event.status !== "processed" && (
                      <Button variant="ghost" size="sm" onClick={() => setMatching(event)}>
                        <UserSearch /> Cocokkan
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {creating && (
        <CreatePartnerDialog
          onClose={() => setCreating(false)}
          onCreated={(code, newSecret) => {
            setSecret({ code, secret: newSecret });
            refresh();
          }}
        />
      )}
      {matching && (
        <MatchDialog
          event={matching}
          onClose={() => setMatching(null)}
          onMatched={() => {
            void queryClient.invalidateQueries({ queryKey: PARTNERS_KEY });
            setMatching(null);
          }}
        />
      )}
      {secret && <SecretDialog code={secret.code} secret={secret.secret} onClose={() => setSecret(null)} />}
      <ConfirmDialog
        open={rotating !== null}
        onOpenChange={(open) => !open && setRotating(null)}
        title={`${rotating?.has_secret ? "Rotasi" : "Buat"} secret ${rotating?.name ?? ""}?`}
        description="Secret lama langsung tidak berlaku. Partner harus memakai secret baru sebelum event berikutnya diterima."
        confirmLabel="Buat secret baru"
        variant="danger"
        loading={update.isPending}
        onConfirm={() => rotating && update.mutate({ id: rotating.id, patch: { rotate_secret: true } })}
      />
    </div>
  );
}

function XpInput({ value, disabled, onSave }: { value: number; disabled: boolean; onSave: (xp: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  const commit = () => {
    const xp = Math.min(PARTNER_XP_CAP, Math.max(0, Math.floor(Number(draft) || 0)));
    setDraft(String(xp));
    if (xp !== value) onSave(xp);
  };
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <Input
        type="number"
        min={0}
        max={PARTNER_XP_CAP}
        className="h-8 w-20"
        value={draft}
        disabled={disabled}
        aria-label="XP per event"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && commit()}
      />
      XP/event
    </span>
  );
}

function CreatePartnerDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (code: string, secret: string) => void }) {
  const [form, setForm] = useState({ code: "", name: "", partner_type: "photobooth" as PartnerType, awards_xp: false, xp: "10" });
  const save = useMutation({
    mutationFn: () =>
      call<{ id: string; code: string; secret: string }>("/api/crm/partners", {
        method: "POST",
        body: JSON.stringify({
          code: form.code.trim(),
          name: form.name.trim(),
          partner_type: form.partner_type,
          awards_xp: form.awards_xp,
          xp_per_event: Math.min(PARTNER_XP_CAP, Math.max(0, Math.floor(Number(form.xp) || 0))),
        }),
      }),
    onSuccess: (result) => {
      onCreated(result.data.code, result.data.secret);
      onClose();
    },
    onError: (error) => toast.error("Partner gagal dibuat", { description: error.message }),
  });
  const valid = /^[A-Za-z0-9_-]{2,40}$/.test(form.code.trim()) && form.name.trim().length >= 2;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPanel size="sm">
        <DialogPanelForm
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) save.mutate();
          }}
        >
          <DialogPanelHeader>
            <DialogPanelTitle>Partner baru</DialogPanelTitle>
            <DialogPanelDescription>Secret penandatangan dibuat otomatis dan hanya ditampilkan sekali.</DialogPanelDescription>
          </DialogPanelHeader>
          <DialogPanelBody className="grid grid-cols-1 gap-4">
            <Field label="Kode" hint="Dipakai di URL endpoint, mis. PHOTOBOOTH_DAGO.">
              <Input value={form.code} onChange={(e) => setForm((c) => ({ ...c, code: e.target.value.toUpperCase() }))} required />
            </Field>
            <Field label="Nama">
              <Input value={form.name} onChange={(e) => setForm((c) => ({ ...c, name: e.target.value }))} required />
            </Field>
            <Field label="Jenis">
              <select
                className={SELECT}
                value={form.partner_type}
                onChange={(e) => setForm((c) => ({ ...c, partner_type: e.target.value as PartnerType }))}
              >
                {PARTNER_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {PARTNER_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </Field>
            <div className="flex items-center justify-between gap-3 rounded-2xl bg-surface-2 px-4 py-3">
              <div>
                <p className="text-sm font-medium">Beri XP untuk event yang cocok</p>
                <p className="text-xs text-muted-foreground">Mati = event hanya dicatat.</p>
              </div>
              <Switch checked={form.awards_xp} onCheckedChange={(next) => setForm((c) => ({ ...c, awards_xp: next }))} />
            </div>
            {form.awards_xp && (
              <Field label="XP per event" hint={`Maksimal ${PARTNER_XP_CAP}.`}>
                <Input type="number" min={0} max={PARTNER_XP_CAP} value={form.xp} onChange={(e) => setForm((c) => ({ ...c, xp: e.target.value }))} />
              </Field>
            )}
          </DialogPanelBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Batal
            </Button>
            <Button type="submit" disabled={!valid || save.isPending}>
              Buat partner
            </Button>
          </DialogFooter>
        </DialogPanelForm>
      </DialogPanel>
    </Dialog>
  );
}

function SecretDialog({ code, secret, onClose }: { code: string; secret: string; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPanel size="sm">
        <DialogPanelHeader>
          <DialogPanelTitle>Secret {code}</DialogPanelTitle>
          <DialogPanelDescription>
            Salin dan kirim ke partner lewat kanal aman. Secret ini tidak bisa dilihat lagi; bila hilang, buat secret baru.
          </DialogPanelDescription>
        </DialogPanelHeader>
        <DialogPanelBody>
          <p className="break-all rounded-2xl bg-surface-2 p-4 font-mono text-sm">{secret}</p>
        </DialogPanelBody>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() =>
              void navigator.clipboard.writeText(secret).then(
                () => toast.success("Secret disalin"),
                () => toast.error("Gagal menyalin, salin manual")
              )
            }
          >
            <Copy /> Salin
          </Button>
          <Button onClick={onClose}>Sudah disimpan</Button>
        </DialogFooter>
      </DialogPanel>
    </Dialog>
  );
}

function MatchDialog({ event, onClose, onMatched }: { event: PartnerEvent; onClose: () => void; onMatched: () => void }) {
  const [identifier, setIdentifier] = useState(event.customer_identifier ?? "");
  const match = useMutation({
    mutationFn: () =>
      call<{ status: string; xp_awarded: number }>("/api/crm/partners/events/rematch", {
        method: "POST",
        body: JSON.stringify({ mode: "manual", event_id: event.id, identifier: identifier.trim() }),
      }),
    onSuccess: (result) => {
      toast.success(result.message ?? "Event dicocokkan", {
        description: result.data.xp_awarded ? `+${result.data.xp_awarded} XP ke member` : undefined,
      });
      onMatched();
    },
    onError: (error) => toast.error("Pencocokan gagal", { description: error.message }),
  });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPanel size="sm">
        <DialogPanelForm
          onSubmit={(e) => {
            e.preventDefault();
            match.mutate();
          }}
        >
          <DialogPanelHeader>
            <DialogPanelTitle>Cocokkan event ke member</DialogPanelTitle>
            <DialogPanelDescription>
              {event.partner_name} · {event.event_type}. Partner mengirim: {event.customer_identifier ?? "tanpa identitas"}.
            </DialogPanelDescription>
          </DialogPanelHeader>
          <DialogPanelBody>
            <Field label="Telepon atau email member" hint="Data asli dari partner tetap disimpan apa adanya.">
              <Input value={identifier} onChange={(e) => setIdentifier(e.target.value)} required />
            </Field>
          </DialogPanelBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Batal
            </Button>
            <Button type="submit" disabled={identifier.trim().length < 5 || match.isPending}>
              Cocokkan
            </Button>
          </DialogFooter>
        </DialogPanelForm>
      </DialogPanel>
    </Dialog>
  );
}
