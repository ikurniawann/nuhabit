"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { apiGet, apiPatch, apiPost } from "@/lib/api-client";
import { CS_PRIORITIES, PRIORITY_LABELS, type CsPriority } from "@/lib/crm/cs-rules";
import {
  actionLabel,
  COMPLAINT_CATEGORIES,
  COMPLAINT_CATEGORY_LABEL,
  COMPLAINT_SOURCE_LABEL,
  COMPLAINT_STATUS_LABEL,
  COMPLAINT_STATUSES,
  type ComplaintCategory,
  type ComplaintSettings,
  complaintSlaState,
  COMPLAINT_KIND_LABEL,
  COMPLAINT_KINDS,
  type ComplaintKind,
  type ComplaintSource,
  type ComplaintStatus,
  MAX_SLA_HOURS,
  nextStatuses,
  type SlaState,
  transitionNeedsNote,
} from "@/lib/studio/complaints";
import type { MemberOption } from "../types";
import { EmptyState, Field, NativeSelect, Pill, StudioPageHeader } from "./ui-bits";
import { ComplaintsReport } from "./complaints-report";

/**
 * Keluhan Pelanggan (EPIC-067 T-067-B1/B2): tiket resmi dari WA inbox, front
 * desk, atau Member App — kategori Hyrox, prioritas, tautan ke member, coach,
 * sesi — dengan alur Diterima → Ditangani → Selesai → Dikonfirmasi member,
 * PIC, catatan internal, dan batas waktu per kategori yang bisa diatur.
 */

interface ComplaintItem {
  id: string;
  code: string;
  kind: ComplaintKind;
  source: ComplaintSource;
  category: ComplaintCategory;
  priority: CsPriority;
  status: ComplaintStatus;
  title: string;
  description: string | null;
  member_name: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  coach_name: string | null;
  session_label: string | null;
  respond_by: string | null;
  resolve_by: string | null;
  first_response_at: string | null;
  respond_escalated_at: string | null;
  resolve_escalated_at: string | null;
  assignee_user_id: string | null;
  assignee_name: string | null;
  created_by_name: string | null;
  created_at: string;
}

interface Staff {
  id: string;
  name: string;
}

const SLA_BADGE: Record<Exclude<SlaState, "ok">, string> = {
  respond_overdue: "Lewat batas respons",
  resolve_overdue: "Lewat batas selesai",
};

interface ComplaintDetail extends ComplaintItem {
  events: { id: string; kind: string; from_status: string | null; to_status: string | null; body: string | null; actor_name: string | null; created_at: string }[];
}

const PRIORITY_TONE: Record<CsPriority, "neutral" | "warning" | "danger"> = { low: "neutral", normal: "neutral", high: "warning", urgent: "danger" };
const STATUS_TONE: Record<ComplaintStatus, "neutral" | "warning" | "positive" | "brand"> = {
  received: "warning",
  in_progress: "neutral",
  resolved: "positive",
  confirmed: "brand",
  cancelled: "neutral",
};

const waktu = (iso: string) =>
  new Date(iso).toLocaleString("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" });

export function StudioComplaintsPage() {
  const [items, setItems] = useState<ComplaintItem[] | null>(null);
  const [status, setStatus] = useState<string>("open");
  const [category, setCategory] = useState<string>("");
  const [kind, setKind] = useState<string>("");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [mine, setMine] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [rev, setRev] = useState(0);
  const [view, setView] = useState<"tickets" | "report">("tickets");

  useEffect(() => {
    apiGet<{ data: { assignees: Staff[] } }>("/api/studio/complaints/settings")
      .then((r) => setStaff(r.data.assignees))
      .catch(() => setStaff([]));
  }, []);

  const load = useCallback(() => {
    const params = new URLSearchParams();
    if (mine) params.set("assignee", "me");
    if (status) params.set("status", status);
    if (category) params.set("category", category);
    if (kind) params.set("kind", kind);
    if (q.trim()) params.set("q", q.trim());
    return apiGet<{ data: ComplaintItem[] }>(`/api/studio/complaints?${params}`)
      .then((r) => setItems(r.data))
      .catch((e) => toast.error(e instanceof Error ? e.message : "Gagal memuat keluhan"));
  }, [status, category, kind, q, mine]);

  const changed = useCallback(async () => {
    setRev((r) => r + 1);
    await load();
  }, [load]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  return (
    <div className="lg:p-6">
      <StudioPageHeader
        title="Keluhan Pelanggan"
        subtitle="Setiap keluhan dicatat sebagai tiket — dari WhatsApp, front desk, atau Member App — lalu ditangani PIC sampai selesai dan dikonfirmasi member, dalam batas waktu per kategori."
        actions={
          <>
            <Button variant="outline" onClick={() => setShowSettings((v) => !v)}>
              <Settings2 className="size-4" /> Pengaturan
            </Button>
            <Button onClick={() => setCreating((v) => !v)}>
              <Plus className="size-4" /> Buat tiket
            </Button>
          </>
        }
      />
      <div className="mb-4 inline-flex rounded-lg border border-border bg-card p-0.5">
        {(["tickets", "report"] as const).map((v) => (
          <button
            key={v}
            type="button"
            aria-pressed={view === v}
            onClick={() => setView(v)}
            className={`rounded-md px-4 py-1.5 text-sm font-medium transition ${view === v ? "bg-nh-forest text-nh-lime" : "text-muted-foreground hover:text-foreground"}`}
          >
            {v === "tickets" ? "Tiket" : "Laporan"}
          </button>
        ))}
      </div>
      {/* Laporan (T-067-B5); daftar tiket tetap ter-mount supaya filter & pilihan tidak hilang saat kembali. */}
      {view === "report" && <ComplaintsReport />}
      <div className={view === "report" ? "hidden" : "grid gap-4"}>
        {showSettings && <ComplaintSettingsPanel staff={staff} onSaved={() => setShowSettings(false)} />}
        {creating && (
          <CreateComplaint
            onCreated={async (id) => {
              setCreating(false);
              setSelected(id);
              await load();
            }}
          />
        )}

        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          <NativeSelect className="sm:max-w-48" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
            <option value="open">Belum ditutup</option>
            <option value="">Semua status</option>
            {COMPLAINT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {COMPLAINT_STATUS_LABEL[s]}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect className="sm:max-w-48" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Kategori">
            <option value="">Semua kategori</option>
            {COMPLAINT_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {COMPLAINT_CATEGORY_LABEL[c]}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect className="sm:max-w-48" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Jenis">
            <option value="">Keluhan & masukan</option>
            {COMPLAINT_KINDS.map((k) => (
              <option key={k} value={k}>
                {COMPLAINT_KIND_LABEL[k]}
              </option>
            ))}
          </NativeSelect>
          <Input className="col-span-2 sm:max-w-xs" placeholder="Cari kode, judul, atau nama" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Cari keluhan" />
          <label className="flex min-h-9 items-center gap-2 rounded-lg border border-border px-3 text-sm text-foreground">
            <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Ditugaskan ke saya
          </label>
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
          <section className="rounded-xl border border-border bg-card shadow-sm">
            {!items ? (
              <Loader2 className="mx-auto my-10 size-5 animate-spin text-muted-foreground" />
            ) : items.length === 0 ? (
              <div className="p-5">
                <EmptyState title="Tidak ada keluhan" description="Keluhan yang cocok dengan filter akan tampil di sini." />
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {items.map((k) => {
                  const sla = complaintSlaState(k, new Date());
                  return (
                    <li key={k.id}>
                      <button
                        type="button"
                        onClick={() => setSelected(k.id)}
                        className={`flex w-full flex-col gap-1 px-4 py-3 text-left transition hover:bg-secondary/40 ${selected === k.id ? "bg-secondary/60" : ""}`}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-xs text-muted-foreground">{k.code}</span>
                          <Pill tone={STATUS_TONE[k.status]}>{COMPLAINT_STATUS_LABEL[k.status]}</Pill>
                          <Pill tone={PRIORITY_TONE[k.priority]}>{PRIORITY_LABELS[k.priority]}</Pill>
                          <Pill>{COMPLAINT_CATEGORY_LABEL[k.category]}</Pill>
                          {k.kind === "feedback" && <Pill tone="brand">Masukan</Pill>}
                          {sla !== "ok" && <Pill tone="danger">{SLA_BADGE[sla]}</Pill>}
                          {(k.respond_escalated_at || k.resolve_escalated_at) && sla !== "ok" && <Pill tone="danger">Dieskalasi</Pill>}
                        </div>
                        <p className="font-medium text-foreground">{k.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {[k.member_name ?? k.contact_name ?? "Tanpa nama", k.coach_name, k.assignee_name ? `PIC ${k.assignee_name}` : "Belum ada PIC", COMPLAINT_SOURCE_LABEL[k.source], waktu(k.created_at)]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
          <ComplaintDetailPanel id={selected} rev={rev} staff={staff} onChanged={changed} />
        </div>
      </div>
    </div>
  );
}

function ComplaintDetailPanel({ id, rev, staff, onChanged }: { id: string | null; rev: number; staff: Staff[]; onChanged: () => Promise<void> }) {
  const [detail, setDetail] = useState<ComplaintDetail | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    apiGet<{ data: ComplaintDetail }>(`/api/studio/complaints/${id}`)
      .then((r) => !cancelled && setDetail(r.data))
      .catch((e) => toast.error(e instanceof Error ? e.message : "Gagal memuat tiket"));
    return () => {
      cancelled = true;
    };
  }, [id, rev]);

  if (!id) {
    return (
      <aside className="hidden rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground lg:block">Pilih tiket untuk melihat detail.</aside>
    );
  }
  if (!detail || detail.id !== id) {
    return (
      <aside className="rounded-xl border border-border bg-card p-6">
        <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
      </aside>
    );
  }
  const d = detail;
  return (
    <aside className="rounded-xl border border-border bg-card p-5 shadow-sm">
      <p className="font-mono text-xs text-muted-foreground">{d.code}</p>
      <h2 className="mt-1 font-display text-lg font-semibold text-foreground">{d.title}</h2>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <Pill tone={STATUS_TONE[d.status]}>{COMPLAINT_STATUS_LABEL[d.status]}</Pill>
        <Pill tone={PRIORITY_TONE[d.priority]}>{PRIORITY_LABELS[d.priority]}</Pill>
        <Pill>{COMPLAINT_CATEGORY_LABEL[d.category]}</Pill>
        {d.kind === "feedback" && <Pill tone="brand">Masukan · tanpa batas waktu</Pill>}
        {d.resolve_escalated_at ? (
          <Pill tone="danger">Dieskalasi: lewat batas selesai</Pill>
        ) : d.respond_escalated_at ? (
          <Pill tone="danger">Dieskalasi: lewat batas respons</Pill>
        ) : null}
      </div>
      {d.description && <p className="mt-3 whitespace-pre-wrap text-sm text-foreground">{d.description}</p>}
      <dl className="mt-4 grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1.5 text-sm">
        <dt className="text-muted-foreground">Pelapor</dt>
        <dd className="text-foreground">{[d.member_name ?? d.contact_name ?? "-", d.contact_phone].filter(Boolean).join(" · ")}</dd>
        <dt className="text-muted-foreground">Coach</dt>
        <dd className="text-foreground">{d.coach_name ?? "-"}</dd>
        <dt className="text-muted-foreground">Sesi</dt>
        <dd className="text-foreground">{d.session_label ?? "-"}</dd>
        <dt className="text-muted-foreground">Sumber</dt>
        <dd className="text-foreground">{COMPLAINT_SOURCE_LABEL[d.source]}</dd>
        <dt className="text-muted-foreground">Respons</dt>
        <dd className="text-foreground">{d.respond_by ? `sebelum ${waktu(d.respond_by)}` : "-"}</dd>
        <dt className="text-muted-foreground">Selesai</dt>
        <dd className="text-foreground">{d.resolve_by ? `sebelum ${waktu(d.resolve_by)}` : "-"}</dd>
        <dt className="text-muted-foreground">Respons pertama</dt>
        <dd className="text-foreground">{d.first_response_at ? waktu(d.first_response_at) : "-"}</dd>
      </dl>
      <ComplaintActions detail={d} staff={staff} onChanged={onChanged} />
      <p className="mt-4 text-[13px] font-semibold text-foreground">Riwayat</p>
      <ol className="mt-1.5 space-y-1.5 border-l border-border pl-3 text-xs">
        {d.events.map((e) => (
          <li key={e.id} className="text-muted-foreground">
            <span className="text-foreground">
              {e.kind === "created"
                ? "Tiket dibuat"
                : e.kind === "status" && e.to_status
                  ? e.from_status === "resolved" && e.to_status === "in_progress"
                    ? "Dibuka lagi"
                    : COMPLAINT_STATUS_LABEL[e.to_status as ComplaintStatus]
                  : e.kind === "note"
                    ? "Catatan"
                    : e.kind === "escalated"
                      ? "Eskalasi"
                      : (e.body ?? e.kind)}
            </span>
            {" · "}
            {e.actor_name ?? (d.source === "member_app" && (e.kind === "created" || e.kind === "status") ? "Member" : "Sistem")} · {waktu(e.created_at)}
            {(e.kind === "created" || e.kind === "note" || e.kind === "status" || e.kind === "escalated") && e.body && (
              <span className="mt-0.5 block whitespace-pre-wrap rounded-md bg-secondary/50 px-2 py-1 text-foreground">{e.body}</span>
            )}
          </li>
        ))}
      </ol>
    </aside>
  );
}

/** Aksi tiket (T-067-B2): PIC, pindah status (dengan catatan bila wajib), catatan internal. */
function ComplaintActions({ detail: d, staff, onChanged }: { detail: ComplaintDetail; staff: Staff[]; onChanged: () => Promise<void> }) {
  const [pending, setPending] = useState<ComplaintStatus | null>(null);
  const [note, setNote] = useState("");
  const [internal, setInternal] = useState("");
  const [busy, setBusy] = useState(false);
  const options = nextStatuses(d.status);
  const closed = options.length === 0;

  async function run<T>(fn: () => Promise<T>, done?: () => void) {
    setBusy(true);
    try {
      const res = (await fn()) as { message?: string };
      toast.success(res?.message ?? "Tersimpan");
      done?.();
      await onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal menyimpan");
    } finally {
      setBusy(false);
    }
  }

  function act(to: ComplaintStatus) {
    if (transitionNeedsNote(d.status, to)) {
      setPending(to);
      setNote("");
      return;
    }
    void run(() => apiPost(`/api/studio/complaints/${d.id}/status`, { to }));
  }

  return (
    <div className="mt-4 grid gap-3 border-t border-border pt-4">
      {d.status !== "confirmed" && d.status !== "cancelled" && (
        <Field label="PIC">
          <NativeSelect
            value={d.assignee_user_id ?? ""}
            disabled={busy}
            onChange={(e) => run(() => apiPost(`/api/studio/complaints/${d.id}/assign`, { user_id: e.target.value || null }))}
          >
            <option value="">— Belum ada PIC —</option>
            {staff.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
      )}

      {!closed && !pending && (
        <div className="flex flex-wrap gap-2">
          {options.map((to) => (
            <Button key={to} size="sm" variant={to === "cancelled" ? "ghost" : to === options[0] ? "default" : "outline"} disabled={busy} onClick={() => act(to)}>
              {actionLabel(d.status, to)}
            </Button>
          ))}
        </div>
      )}
      {pending && (
        <div className="grid gap-2 rounded-lg border border-border p-3">
          <p className="text-[13px] font-semibold text-foreground">{actionLabel(d.status, pending)}</p>
          <Textarea
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={pending === "resolved" ? "Apa yang sudah dilakukan untuk menyelesaikan keluhan ini?" : "Alasannya"}
            aria-label="Catatan perubahan status"
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={busy || note.trim().length < 3}
              onClick={() => run(() => apiPost(`/api/studio/complaints/${d.id}/status`, { to: pending, note: note.trim() }), () => setPending(null))}
            >
              {busy && <Loader2 className="size-3.5 animate-spin" />} Simpan
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setPending(null)}>
              Batal
            </Button>
          </div>
        </div>
      )}

      <div className="grid gap-2">
        <Textarea rows={2} value={internal} onChange={(e) => setInternal(e.target.value)} placeholder="Catatan internal (tidak dikirim ke member)" aria-label="Catatan internal" />
        <div>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || internal.trim().length < 2}
            onClick={() => run(() => apiPost(`/api/studio/complaints/${d.id}/notes`, { body: internal.trim() }), () => setInternal(""))}
          >
            Simpan catatan
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Batas waktu respons/selesai & PIC default per kategori (berlaku untuk tiket baru). */
function ComplaintSettingsPanel({ staff, onSaved }: { staff: Staff[]; onSaved: () => void }) {
  const [settings, setSettings] = useState<ComplaintSettings | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiGet<{ data: { settings: ComplaintSettings } }>("/api/studio/complaints/settings")
      .then((r) => setSettings(r.data.settings))
      .catch((e) => toast.error(e instanceof Error ? e.message : "Gagal memuat pengaturan"));
  }, []);

  if (!settings) return <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />;
  const hours = (v: string) => Math.min(MAX_SLA_HOURS, Math.max(1, Math.floor(Number(v) || 1)));
  const setRule = (c: ComplaintCategory, k: "respond_hours" | "resolve_hours", v: number) =>
    setSettings((s) => (s ? { ...s, sla_rules: { ...s.sla_rules, [c]: { ...s.sla_rules[c], [k]: v } } } : s));

  async function save() {
    if (!settings) return;
    setBusy(true);
    try {
      await apiPatch("/api/studio/complaints/settings", settings);
      toast.success("Pengaturan keluhan disimpan");
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal menyimpan");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
      <p className="text-[13px] font-semibold text-foreground">Batas waktu & PIC default per kategori</p>
      <p className="mt-0.5 text-sm text-muted-foreground">Berlaku untuk tiket baru; tiket lama tetap memakai batas waktu saat dibuat.</p>
      <p className="mt-1 text-sm text-muted-foreground">
        Lewat batas waktu → WA eskalasi ke PIC tiket dan ke penerima di{" "}
        <a href="/dashboard/settings/wa-notifications" className="font-semibold text-foreground underline underline-offset-4">
          Notifikasi WA
        </a>{" "}
        (jenis &ldquo;Tiket keluhan lewat batas waktu&rdquo;) — isi nomor Head Coach / Ops di sana. Di luar 08.00–21.00 hanya tiket cedera atau prioritas tinggi yang langsung dikirim.
      </p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[520px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="py-2 pr-3 font-semibold">Kategori</th>
              <th className="w-28 py-2 pr-3 font-semibold">Respons (jam)</th>
              <th className="w-28 py-2 pr-3 font-semibold">Selesai (jam)</th>
              <th className="py-2 font-semibold">PIC default</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {COMPLAINT_CATEGORIES.map((c) => (
              <tr key={c}>
                <td className="py-2 pr-3 text-foreground">{COMPLAINT_CATEGORY_LABEL[c]}</td>
                <td className="py-2 pr-3">
                  <Input type="number" min={1} max={MAX_SLA_HOURS} value={settings.sla_rules[c].respond_hours} onChange={(e) => setRule(c, "respond_hours", hours(e.target.value))} aria-label={`Respons ${COMPLAINT_CATEGORY_LABEL[c]}`} />
                </td>
                <td className="py-2 pr-3">
                  <Input type="number" min={1} max={MAX_SLA_HOURS} value={settings.sla_rules[c].resolve_hours} onChange={(e) => setRule(c, "resolve_hours", hours(e.target.value))} aria-label={`Selesai ${COMPLAINT_CATEGORY_LABEL[c]}`} />
                </td>
                <td className="py-2">
                  <NativeSelect
                    value={settings.default_assignees[c] ?? ""}
                    onChange={(e) => setSettings((s) => (s ? { ...s, default_assignees: { ...s.default_assignees, [c]: e.target.value || null } } : s))}
                    aria-label={`PIC default ${COMPLAINT_CATEGORY_LABEL[c]}`}
                  >
                    <option value="">— Tidak ada —</option>
                    {staff.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </NativeSelect>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3">
        <Button onClick={save} disabled={busy}>
          {busy && <Loader2 className="size-4 animate-spin" />} Simpan pengaturan
        </Button>
      </div>
    </section>
  );
}

const EMPTY = { category: "coach" as ComplaintCategory, priority: "" as "" | CsPriority, title: "", description: "", contact_name: "", contact_phone: "", coach_id: "", session_id: "" };

function CreateComplaint({ onCreated }: { onCreated: (id: string) => Promise<void> }) {
  const [form, setForm] = useState(EMPTY);
  const [member, setMember] = useState<MemberOption | null>(null);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<{ q: string; items: MemberOption[] } | null>(null);
  const [sessions, setSessions] = useState<{ id: string; label: string; coach_id: string | null }[]>([]);
  const [coaches, setCoaches] = useState<{ id: string; full_name: string; display_name: string | null; is_active: boolean }[]>([]);
  const [busy, setBusy] = useState(false);
  const term = search.trim();

  useEffect(() => {
    apiGet<{ data: { id: string; full_name: string; display_name: string | null; is_active: boolean }[] }>("/api/studio/coaches?active=1")
      .then((r) => setCoaches(r.data))
      .catch(() => setCoaches([]));
  }, []);

  useEffect(() => {
    if (member || term.length < 2) return;
    const t = setTimeout(() => {
      apiGet<{ data: MemberOption[] }>(`/api/studio/members?q=${encodeURIComponent(term)}`)
        .then((r) => setResults({ q: term, items: r.data }))
        .catch(() => setResults({ q: term, items: [] }));
    }, 300);
    return () => clearTimeout(t);
  }, [term, member]);

  function pickMember(m: MemberOption) {
    setMember(m);
    apiGet<{ data: { id: string; label: string; coach_id: string | null }[] }>(`/api/studio/complaints/member-sessions?customer_id=${m.id}`)
      .then((r) => setSessions(r.data))
      .catch(() => setSessions([]));
  }

  const set = <K extends keyof typeof EMPTY>(k: K, v: (typeof EMPTY)[K]) => setForm((f) => ({ ...f, [k]: v }));

  async function save() {
    setBusy(true);
    try {
      const res = await apiPost<{ data: { id: string; code: string }; message?: string }>("/api/studio/complaints", {
        category: form.category,
        ...(form.priority ? { priority: form.priority } : {}),
        title: form.title.trim() || null,
        description: form.description.trim() || null,
        customer_id: member?.id ?? null,
        contact_name: member ? null : form.contact_name.trim() || null,
        contact_phone: member ? null : form.contact_phone.trim() || null,
        coach_id: form.coach_id || null,
        session_id: form.session_id || null,
      });
      toast.success(res.message ?? "Tiket dibuat");
      setForm(EMPTY);
      setMember(null);
      await onCreated(res.data.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal membuat tiket");
    } finally {
      setBusy(false);
    }
  }

  const items = results && results.q === term ? results.items : [];
  const canSave = !busy && (form.description.trim().length >= 5 || form.title.trim().length >= 3) && (member || form.contact_name.trim());

  return (
    <section className="grid gap-4 rounded-xl border border-border bg-card p-5 shadow-sm">
      <p className="text-[13px] font-semibold text-foreground">Tiket baru (front desk)</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Kategori">
          <NativeSelect value={form.category} onChange={(e) => set("category", e.target.value as ComplaintCategory)}>
            {COMPLAINT_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {COMPLAINT_CATEGORY_LABEL[c]}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Prioritas" hint="Kosong = otomatis (cedera → Tinggi).">
          <NativeSelect value={form.priority} onChange={(e) => set("priority", e.target.value as "" | CsPriority)}>
            <option value="">Otomatis</option>
            {CS_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABELS[p]}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Member" className="sm:col-span-2">
          {member ? (
            <div className="flex items-center justify-between rounded-lg bg-secondary/50 px-3 py-2 text-sm">
              <span className="text-foreground">
                {member.name ?? "Member"} · <span className="text-muted-foreground">{member.phone}</span>
              </span>
              <Button variant="ghost" size="sm" onClick={() => { setMember(null); setSessions([]); set("session_id", ""); }}>
                Ganti
              </Button>
            </div>
          ) : (
            <>
              <Input placeholder="Cari member (nama / HP) — kosongkan bila bukan member" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Cari member" />
              {items.length > 0 && (
                <ul className="mt-1 divide-y divide-border rounded-lg border border-border">
                  {items.map((m) => (
                    <li key={m.id}>
                      <button type="button" onClick={() => pickMember(m)} className="flex w-full justify-between px-3 py-1.5 text-left text-sm hover:bg-secondary/50">
                        <span>{m.name ?? "Member"}</span>
                        <span className="text-xs text-muted-foreground">{m.phone}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </Field>
        {!member && (
          <>
            <Field label="Nama pelapor">
              <Input value={form.contact_name} onChange={(e) => set("contact_name", e.target.value)} />
            </Field>
            <Field label="Nomor HP pelapor">
              <Input value={form.contact_phone} onChange={(e) => set("contact_phone", e.target.value)} />
            </Field>
          </>
        )}
        {member && sessions.length > 0 && (
          <Field label="Sesi terkait (opsional)" hint="Coach otomatis mengikuti sesi bila tidak dipilih.">
            <NativeSelect value={form.session_id} onChange={(e) => set("session_id", e.target.value)}>
              <option value="">— Tidak terkait sesi —</option>
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
        )}
        <Field label="Coach terkait (opsional)">
          <NativeSelect value={form.coach_id} onChange={(e) => set("coach_id", e.target.value)}>
            <option value="">— Tidak ada / ikut sesi —</option>
            {coaches.map((c) => (
              <option key={c.id} value={c.id}>
                {c.display_name || c.full_name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Judul (opsional)" className="sm:col-span-2">
          <Input maxLength={120} value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="Kosong = diambil dari isi keluhan" />
        </Field>
        <Field label="Isi keluhan" className="sm:col-span-2">
          <Textarea rows={3} maxLength={2000} value={form.description} onChange={(e) => set("description", e.target.value)} />
        </Field>
      </div>
      <div>
        <Button onClick={save} disabled={!canSave}>
          {busy && <Loader2 className="size-4 animate-spin" />} Simpan tiket
        </Button>
      </div>
    </section>
  );
}
