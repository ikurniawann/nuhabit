"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Lock, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api-client";
import { FLAG_NOTE_MAX, FLAG_SEVERITIES, type FlagSeverity, type FlagType, type MemberFlag, SEVERITY_LABEL } from "@/lib/studio/member-flags";
import type { MemberOption } from "../types";
import { EmptyState, Field, NativeSelect, Pill, StudioPageHeader } from "./ui-bits";

/**
 * Member Perhatian Khusus (EPIC-067 T-067-C1). Backoffice mengelola penanda
 * umum (pemula, VIP, pernah komplain, …). Penanda medis hanya tampil sebagai
 * jumlah — detailnya khusus coach yang mengajar member itu (Coach Portal).
 */

interface MemberFlags {
  customer_id: string;
  name: string | null;
  phone: string | null;
  general: MemberFlag[];
  medical_count: number;
}

interface FlagData {
  types: FlagType[];
  members: MemberFlags[];
}

const SEVERITY_TONE: Record<FlagSeverity, "neutral" | "warning" | "danger"> = { info: "neutral", attention: "warning", critical: "danger" };
const EMPTY_FORM = { type_id: "", severity: "attention" as FlagSeverity, note: "", valid_until: "" };

export function StudioMemberFlagsPage() {
  const [data, setData] = useState<FlagData | null>(null);

  const load = useCallback(
    () =>
      apiGet<{ data: FlagData }>("/api/studio/member-flags")
        .then((r) => setData(r.data))
        .catch((e) => toast.error(e instanceof Error ? e.message : "Gagal memuat")),
    []
  );

  useEffect(() => {
    load();
  }, [load]);

  async function remove(id: string) {
    try {
      await apiDelete(`/api/studio/member-flags/${id}`);
      toast.success("Penanda dihapus");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal menghapus");
    }
  }

  if (!data) {
    return (
      <div className="flex justify-center p-16 text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="lg:p-6">
      <StudioPageHeader
        title="Member Perhatian Khusus"
        subtitle="Penanda umum (pemula, VIP, pernah komplain) dikelola di sini dan terlihat oleh coach. Penanda medis dicatat coach di Coach Portal; detailnya hanya terlihat oleh coach yang mengajar member tersebut."
      />
      <div className="grid max-w-4xl gap-4">
        <AddFlag types={data.types.filter((t) => t.is_active && t.category === "general")} onSaved={load} />

        <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <p className="text-[13px] font-semibold text-foreground">Member dengan penanda aktif</p>
          <div className="mt-3">
            {data.members.length === 0 ? (
              <EmptyState title="Belum ada member dengan penanda" />
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {data.members.map((m) => (
                  <li key={m.customer_id} className="p-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="font-medium text-foreground">{m.name ?? "Member"}</p>
                      <span className="text-xs text-muted-foreground">{m.phone}</span>
                    </div>
                    <FlagChips flags={m.general} medicalCount={m.medical_count} onRemove={remove} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <FlagTypes types={data.types} onChanged={load} />
      </div>
    </div>
  );
}

function FlagChips({ flags, medicalCount, onRemove }: { flags: MemberFlag[]; medicalCount: number; onRemove?: (id: string) => void }) {
  if (flags.length === 0 && medicalCount === 0) return <p className="mt-1 text-xs text-muted-foreground">Belum ada penanda.</p>;
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {flags.map((f) => (
        <span key={f.id} className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-secondary/50 py-0.5 pl-1 pr-2 text-xs">
          <Pill tone={SEVERITY_TONE[f.severity]} className="px-2">
            {f.type_label}
          </Pill>
          <span className="truncate text-foreground">{f.note ?? SEVERITY_LABEL[f.severity]}</span>
          {f.valid_until && <span className="shrink-0 text-muted-foreground">s/d {f.valid_until}</span>}
          {onRemove && (
            <button type="button" aria-label={`Hapus penanda ${f.type_label}`} className="shrink-0 text-muted-foreground hover:text-destructive" onClick={() => onRemove(f.id)}>
              <X className="size-3.5" />
            </button>
          )}
        </span>
      ))}
      {medicalCount > 0 && (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-0.5 text-xs text-muted-foreground" title="Detail hanya terlihat oleh coach yang mengajar member ini">
          <Lock className="size-3" />
          {medicalCount} catatan medis · hanya coach
        </span>
      )}
    </div>
  );
}

function AddFlag({ types, onSaved }: { types: FlagType[]; onSaved: () => Promise<unknown> }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ q: string; items: MemberOption[] } | null>(null);
  const [member, setMember] = useState<MemberOption | null>(null);
  const [current, setCurrent] = useState<MemberFlags | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM, type_id: types[0]?.id ?? "" });
  const [busy, setBusy] = useState(false);
  const term = q.trim();

  useEffect(() => {
    if (member || term.length < 2) return;
    const t = setTimeout(() => {
      apiGet<{ data: MemberOption[] }>(`/api/studio/members?q=${encodeURIComponent(term)}`)
        .then((r) => setResults({ q: term, items: r.data }))
        .catch(() => setResults({ q: term, items: [] }));
    }, 300);
    return () => clearTimeout(t);
  }, [term, member]);

  const loadCurrent = useCallback(
    (customerId: string) =>
      apiGet<{ data: { members: MemberFlags[] } }>(`/api/studio/member-flags?customer_id=${customerId}`)
        .then((r) => setCurrent(r.data.members[0] ?? null))
        .catch(() => setCurrent(null)),
    []
  );

  function pick(m: MemberOption) {
    setMember(m);
    setCurrent(null);
    loadCurrent(m.id);
  }

  async function save() {
    if (!member) return;
    setBusy(true);
    try {
      await apiPost("/api/studio/member-flags", {
        customer_id: member.id,
        type_id: form.type_id,
        severity: form.severity,
        note: form.note.trim() || null,
        valid_until: form.valid_until || null,
      });
      toast.success("Penanda ditambahkan");
      setForm({ ...EMPTY_FORM, type_id: types[0]?.id ?? "" });
      await Promise.all([loadCurrent(member.id), onSaved()]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal menyimpan");
    } finally {
      setBusy(false);
    }
  }

  const items = results && results.q === term ? results.items : [];

  return (
    <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
      <p className="text-[13px] font-semibold text-foreground">Tambah penanda</p>
      {!member ? (
        <div className="mt-3">
          <Input placeholder="Cari member (nama atau nomor HP)" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Cari member" />
          {items.length > 0 && (
            <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
              {items.map((m) => (
                <li key={m.id}>
                  <button type="button" className="flex w-full items-baseline justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-secondary/50" onClick={() => pick(m)}>
                    <span className="font-medium text-foreground">{m.name ?? "Member"}</span>
                    <span className="text-xs text-muted-foreground">{m.phone}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="mt-3 grid gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-secondary/50 px-3 py-2">
            <div>
              <p className="font-medium text-foreground">{member.name ?? "Member"}</p>
              <p className="text-xs text-muted-foreground">{member.phone}</p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setMember(null)}>
              Ganti member
            </Button>
          </div>
          {current && <FlagChips flags={current.general} medicalCount={current.medical_count} />}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Jenis">
              <NativeSelect value={form.type_id} onChange={(e) => setForm((f) => ({ ...f, type_id: e.target.value }))}>
                {types.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Tingkat">
              <NativeSelect value={form.severity} onChange={(e) => setForm((f) => ({ ...f, severity: e.target.value as FlagSeverity }))}>
                {FLAG_SEVERITIES.map((s) => (
                  <option key={s} value={s}>
                    {SEVERITY_LABEL[s]}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Catatan singkat" hint={`Maks ${FLAG_NOTE_MAX} karakter. Terlihat oleh coach.`} className="sm:col-span-2">
              <Input maxLength={FLAG_NOTE_MAX} value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} placeholder="Contoh: baru pertama kali ikut Hyrox" />
            </Field>
            <Field label="Berlaku sampai (opsional)">
              <Input type="date" value={form.valid_until} onChange={(e) => setForm((f) => ({ ...f, valid_until: e.target.value }))} />
            </Field>
          </div>
          <div>
            <Button onClick={save} disabled={busy || !form.type_id}>
              {busy && <Loader2 className="size-4 animate-spin" />} Simpan penanda
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

function FlagTypes({ types, onChanged }: { types: FlagType[]; onChanged: () => Promise<unknown> }) {
  const [label, setLabel] = useState("");
  const [category, setCategory] = useState<"general" | "medical">("general");
  const [busy, setBusy] = useState(false);

  async function add() {
    setBusy(true);
    try {
      await apiPost("/api/studio/member-flags/types", { label: label.trim(), category });
      setLabel("");
      toast.success("Jenis penanda ditambahkan");
      await onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal menambah");
    } finally {
      setBusy(false);
    }
  }

  async function toggle(t: FlagType, active: boolean) {
    try {
      await apiPatch(`/api/studio/member-flags/types/${t.id}`, { is_active: active });
      await onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal menyimpan");
    }
  }

  return (
    <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
      <p className="text-[13px] font-semibold text-foreground">Jenis penanda</p>
      <p className="mt-0.5 text-sm text-muted-foreground">Jenis medis hanya bisa dicatat coach. Menonaktifkan jenis tidak menghapus penanda yang sudah ada.</p>
      <ul className="mt-3 divide-y divide-border rounded-lg border border-border">
        {types.map((t) => (
          <li key={t.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
            <span className="flex items-center gap-2 text-foreground">
              {t.label}
              <Pill tone={t.category === "medical" ? "danger" : "neutral"}>{t.category === "medical" ? "Medis" : "Umum"}</Pill>
            </span>
            <Switch checked={t.is_active} onCheckedChange={(v) => toggle(t, v)} aria-label={`${t.label} aktif`} />
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap gap-2">
        <Input className="max-w-xs" placeholder="Jenis baru, mis. Atlet kompetisi" value={label} onChange={(e) => setLabel(e.target.value)} aria-label="Nama jenis baru" />
        <NativeSelect className="max-w-40" value={category} onChange={(e) => setCategory(e.target.value as "general" | "medical")} aria-label="Kategori">
          <option value="general">Umum</option>
          <option value="medical">Medis</option>
        </NativeSelect>
        <Button variant="outline" onClick={add} disabled={busy || label.trim().length < 2}>
          Tambah jenis
        </Button>
      </div>
    </section>
  );
}
