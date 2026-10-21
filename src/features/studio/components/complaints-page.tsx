"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { apiGet, apiPost } from "@/lib/api-client";
import { CS_PRIORITIES, PRIORITY_LABELS, type CsPriority } from "@/lib/crm/cs-rules";
import {
  COMPLAINT_CATEGORIES,
  COMPLAINT_CATEGORY_LABEL,
  COMPLAINT_SOURCE_LABEL,
  COMPLAINT_STATUS_LABEL,
  COMPLAINT_STATUSES,
  type ComplaintCategory,
  type ComplaintSource,
  type ComplaintStatus,
} from "@/lib/studio/complaints";
import type { MemberOption } from "../types";
import { EmptyState, Field, NativeSelect, Pill, StudioPageHeader } from "./ui-bits";

/**
 * Keluhan Pelanggan (EPIC-067 T-067-B1): tiket resmi dari WA inbox, front desk,
 * atau Member App — kategori Hyrox, prioritas, dan tautan ke member, coach,
 * sesi. Alur penyelesaian (PIC, status, eskalasi) menyusul di T-067-B2.
 */

interface ComplaintItem {
  id: string;
  code: string;
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
  created_by_name: string | null;
  created_at: string;
}

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
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (category) params.set("category", category);
    if (q.trim()) params.set("q", q.trim());
    return apiGet<{ data: ComplaintItem[] }>(`/api/studio/complaints?${params}`)
      .then((r) => setItems(r.data))
      .catch((e) => toast.error(e instanceof Error ? e.message : "Gagal memuat keluhan"));
  }, [status, category, q]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  return (
    <div className="p-4 sm:p-6">
      <StudioPageHeader
        title="Keluhan Pelanggan"
        subtitle="Setiap keluhan dicatat sebagai tiket — dari WhatsApp, front desk, atau Member App — dengan kategori, prioritas, dan batas waktu respons."
        actions={
          <Button onClick={() => setCreating((v) => !v)}>
            <Plus className="size-4" /> Buat tiket
          </Button>
        }
      />
      <div className="grid gap-4">
        {creating && (
          <CreateComplaint
            onCreated={async (id) => {
              setCreating(false);
              setSelected(id);
              await load();
            }}
          />
        )}

        <div className="flex flex-wrap gap-2">
          <NativeSelect className="max-w-48" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
            <option value="open">Terbuka</option>
            <option value="">Semua status</option>
            {COMPLAINT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {COMPLAINT_STATUS_LABEL[s]}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect className="max-w-48" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Kategori">
            <option value="">Semua kategori</option>
            {COMPLAINT_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {COMPLAINT_CATEGORY_LABEL[c]}
              </option>
            ))}
          </NativeSelect>
          <Input className="max-w-xs" placeholder="Cari kode, judul, atau nama" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Cari keluhan" />
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
                  const overdue = k.status === "received" && k.respond_by && new Date(k.respond_by) < new Date();
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
                          {overdue && <Pill tone="danger">Lewat batas respons</Pill>}
                        </div>
                        <p className="font-medium text-foreground">{k.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {[k.member_name ?? k.contact_name ?? "Tanpa nama", k.coach_name, COMPLAINT_SOURCE_LABEL[k.source], waktu(k.created_at)]
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
          <ComplaintDetailPanel id={selected} />
        </div>
      </div>
    </div>
  );
}

function ComplaintDetailPanel({ id }: { id: string | null }) {
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
  }, [id]);

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
      </dl>
      <p className="mt-4 text-[13px] font-semibold text-foreground">Riwayat</p>
      <ol className="mt-1.5 space-y-1.5 border-l border-border pl-3 text-xs">
        {d.events.map((e) => (
          <li key={e.id} className="text-muted-foreground">
            <span className="text-foreground">{e.kind === "created" ? "Tiket dibuat" : e.kind === "status" && e.to_status ? COMPLAINT_STATUS_LABEL[e.to_status as ComplaintStatus] : e.body ?? e.kind}</span>
            {" · "}
            {e.actor_name ?? "Sistem"} · {waktu(e.created_at)}
          </li>
        ))}
      </ol>
    </aside>
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
