"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Circle, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { apiGet, apiPatch, apiPost } from "@/lib/api-client";
import { SOP_BODY_MAX, SOP_TITLE_MAX } from "@/lib/studio/sop";
import { EmptyState, Field, Pill, StudioPageHeader } from "./ui-bits";

/**
 * SOP Coach (EPIC-067 T-067-D1): dokumen berversi. Setiap terbitan = versi baru
 * yang wajib dikonfirmasi ulang coach di Coach Portal; laporan siapa yang belum.
 */

interface SopRow {
  id: string;
  title: string;
  is_active: boolean;
  version: number;
  published_at: string;
  coaches_total: number;
  coaches_acked: number;
}

interface SopDetail {
  id: string;
  is_active: boolean;
  version: number;
  title: string;
  body: string;
  change_note: string | null;
  published_at: string;
  versions: { id: string; version: number; change_note: string | null; published_at: string; published_by_name: string | null; acked: number }[];
  coaches: { coach_id: string; coach_name: string; has_login: boolean; acknowledged_at: string | null }[];
}

const tgl = (iso: string) => new Date(iso).toLocaleString("id-ID", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" });

export function StudioSopPage() {
  const [rows, setRows] = useState<SopRow[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [rev, setRev] = useState(0);

  const load = useCallback(
    () =>
      apiGet<{ data: SopRow[] }>("/api/studio/sop")
        .then((r) => {
          setRows(r.data);
          setSelected((s) => s ?? r.data[0]?.id ?? null);
        })
        .catch((e) => toast.error(e instanceof Error ? e.message : "Gagal memuat SOP")),
    []
  );

  useEffect(() => {
    load();
  }, [load]);

  const changed = async () => {
    setRev((r) => r + 1);
    await load();
  };

  return (
    <div className="lg:p-6">
      <StudioPageHeader
        title="SOP Coach"
        subtitle="Dokumen SOP berversi. Setiap versi baru wajib dibaca dan dikonfirmasi coach di Coach Portal — laporan di bawah menunjukkan siapa yang belum."
        actions={
          <Button onClick={() => setCreating((v) => !v)}>
            <Plus className="size-4" /> Buat SOP
          </Button>
        }
      />
      <div className="grid gap-4">
        {creating && (
          <SopEditor
            mode="create"
            onCancel={() => setCreating(false)}
            onSaved={async (id) => {
              setCreating(false);
              setSelected(id);
              await changed();
            }}
          />
        )}
        {!rows ? (
          <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
        ) : rows.length === 0 && !creating ? (
          <EmptyState
            title="Belum ada SOP"
            description="Buat SOP coach — bisa langsung dari template yang berisi aturan cuti, pengganti, sanksi, dan keluhan sesuai pengaturan saat ini."
            action={<Button onClick={() => setCreating(true)}>Buat SOP</Button>}
          />
        ) : (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
            <ul className="divide-y divide-border self-start rounded-xl border border-border bg-card shadow-sm">
              {rows.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(r.id)}
                    className={`flex w-full flex-col gap-1 px-4 py-3 text-left transition hover:bg-secondary/40 ${selected === r.id ? "bg-secondary/60" : ""}`}
                  >
                    <span className="font-medium text-foreground">{r.title}</span>
                    <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      Versi {r.version} ·{" "}
                      <Pill tone={r.coaches_acked >= r.coaches_total ? "positive" : "warning"}>
                        {r.coaches_acked}/{r.coaches_total} coach konfirmasi
                      </Pill>
                      {!r.is_active && <Pill>Arsip</Pill>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {selected && <SopDetailPanel id={selected} rev={rev} onChanged={changed} />}
          </div>
        )}
      </div>
    </div>
  );
}

function SopDetailPanel({ id, rev, onChanged }: { id: string; rev: number; onChanged: () => Promise<void> }) {
  const [d, setD] = useState<SopDetail | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiGet<{ data: SopDetail }>(`/api/studio/sop/${id}`)
      .then((r) => !cancelled && setD(r.data))
      .catch((e) => toast.error(e instanceof Error ? e.message : "Gagal memuat SOP"));
    return () => {
      cancelled = true;
    };
  }, [id, rev]);

  if (!d || d.id !== id) return <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />;
  const pending = d.coaches.filter((c) => !c.acknowledged_at);
  const remindable = pending.filter((c) => c.has_login);

  async function act(fn: () => Promise<{ message?: string }>) {
    setBusy(true);
    try {
      const r = await fn();
      toast.success(r.message ?? "Tersimpan");
      await onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal menyimpan");
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <SopEditor
        mode="version"
        docId={d.id}
        initial={{ title: d.title, body: d.body }}
        nextVersion={d.version + 1}
        onCancel={() => setEditing(false)}
        onSaved={async () => {
          setEditing(false);
          await onChanged();
        }}
      />
    );
  }

  return (
    <div className="grid gap-4">
      <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="font-display text-lg font-semibold text-foreground">{d.title}</h2>
            <p className="text-xs text-muted-foreground">
              Versi {d.version} · terbit {tgl(d.published_at)}
              {d.change_note ? ` · ${d.change_note}` : ""}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {d.is_active && (
              <Button size="sm" onClick={() => setEditing(true)}>
                Terbitkan versi baru
              </Button>
            )}
            <Button size="sm" variant="outline" disabled={busy} onClick={() => act(() => apiPatch(`/api/studio/sop/${d.id}`, { is_active: !d.is_active }))}>
              {d.is_active ? "Arsipkan" : "Aktifkan"}
            </Button>
          </div>
        </div>
        <div className="mt-4 max-h-[28rem] overflow-y-auto whitespace-pre-wrap rounded-lg bg-secondary/40 p-4 text-sm leading-relaxed text-foreground">{d.body}</div>
      </section>

      <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[13px] font-semibold text-foreground">
            Konfirmasi versi {d.version}: {d.coaches.length - pending.length}/{d.coaches.length} coach
          </p>
          {d.is_active && remindable.length > 0 && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => act(() => apiPost(`/api/studio/sop/${d.id}/remind`, {}))}>
              Kirim pengingat WA ({remindable.length})
            </Button>
          )}
        </div>
        <ul className="mt-3 divide-y divide-border rounded-lg border border-border text-sm">
          {d.coaches.map((c) => (
            <li key={c.coach_id} className="flex items-center justify-between gap-2 px-3 py-2">
              <span className="flex items-center gap-2 text-foreground">
                {c.acknowledged_at ? <CheckCircle2 className="size-4 text-nh-forest dark:text-nh-lime" /> : <Circle className="size-4 text-muted-foreground" />}
                {c.coach_name}
              </span>
              <span className="text-xs text-muted-foreground">
                {c.acknowledged_at ? `Setuju ${tgl(c.acknowledged_at)}` : c.has_login ? "Belum konfirmasi" : "Belum punya akun Coach Portal"}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
        <p className="text-[13px] font-semibold text-foreground">Riwayat versi</p>
        <ul className="mt-2 space-y-1.5 text-sm">
          {d.versions.map((v) => (
            <li key={v.id} className="text-muted-foreground">
              <span className="font-medium text-foreground">Versi {v.version}</span> · {tgl(v.published_at)}
              {v.published_by_name ? ` · ${v.published_by_name}` : ""} · {v.acked} konfirmasi
              {v.change_note ? ` · ${v.change_note}` : ""}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function SopEditor(props: {
  mode: "create" | "version";
  docId?: string;
  initial?: { title: string; body: string };
  nextVersion?: number;
  onCancel: () => void;
  onSaved: (id: string) => Promise<void>;
}) {
  const [title, setTitle] = useState(props.initial?.title ?? "");
  const [body, setBody] = useState(props.initial?.body ?? "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function fromTemplate() {
    try {
      const t = (await apiGet<{ data: { title: string; body: string } }>("/api/studio/sop/template")).data;
      if (!title.trim()) setTitle(t.title);
      setBody(t.body);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal memuat template");
    }
  }

  async function save() {
    setBusy(true);
    try {
      const payload = { title: title.trim(), body: body.trim(), change_note: note.trim() || null };
      if (props.mode === "create") {
        const r = await apiPost<{ data: { id: string }; message?: string }>("/api/studio/sop", payload);
        toast.success(r.message ?? "SOP diterbitkan");
        await props.onSaved(r.data.id);
      } else {
        const r = await apiPost<{ message?: string }>(`/api/studio/sop/${props.docId}/versions`, payload);
        toast.success(r.message ?? "Versi baru diterbitkan");
        await props.onSaved(props.docId!);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal menerbitkan");
    } finally {
      setBusy(false);
    }
  }

  const needsNote = props.mode === "version";
  const canSave = !busy && title.trim().length >= 3 && body.trim().length >= 20 && (!needsNote || note.trim().length >= 3);

  return (
    <section className="grid gap-3 rounded-xl border border-border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px] font-semibold text-foreground">{props.mode === "create" ? "SOP baru (terbit sebagai versi 1)" : `Versi ${props.nextVersion}`}</p>
        <Button size="sm" variant="outline" onClick={fromTemplate}>
          Isi dari template (pengaturan saat ini)
        </Button>
      </div>
      <Field label="Judul">
        <Input maxLength={SOP_TITLE_MAX} value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Field label="Isi SOP" hint="Teks biasa; baris baru dipertahankan. Setelah terbit, isi versi tidak bisa diubah — terbitkan versi baru bila ada perubahan.">
        <Textarea rows={18} maxLength={SOP_BODY_MAX} value={body} onChange={(e) => setBody(e.target.value)} className="font-mono text-xs" />
      </Field>
      <Field label={needsNote ? "Ringkasan perubahan (wajib)" : "Catatan (opsional)"}>
        <Input maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder={needsNote ? "Mis. minimal cuti tahunan jadi H-14" : ""} />
      </Field>
      <div className="flex gap-2">
        <Button onClick={save} disabled={!canSave}>
          {busy && <Loader2 className="size-4 animate-spin" />} Terbitkan
        </Button>
        <Button variant="ghost" onClick={props.onCancel}>
          Batal
        </Button>
      </div>
    </section>
  );
}
