"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Field, TableNote } from "@/features/crm/engagement/components/shared";
import { SELECT } from "@/features/gym/shared";
import { COMPLAINT_KEYS, PRIORITIES, PRIORITY_LABEL, complaintsApi, type Category, type Options, type Settings } from "../api";

/** Pengaturan keluhan: SLA per prioritas, jam kerja dan kontak eskalasi per cabang, serta daftar kategori. */
export function ComplaintSettings() {
  const [branch, setBranch] = useState("");
  const options = useQuery({ queryKey: COMPLAINT_KEYS.options, queryFn: complaintsApi.options });
  const settings = useQuery({ queryKey: COMPLAINT_KEYS.settings(branch), queryFn: () => complaintsApi.settings(branch) });

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <Field label="Berlaku untuk" hint="Cabang tanpa pengaturan sendiri memakai pengaturan default.">
          <select className={SELECT} value={branch} onChange={(e) => setBranch(e.target.value)}>
            <option value="">Default semua cabang</option>
            {options.data?.branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </Field>
      </Card>
      {settings.isLoading || !options.data ? (
        <TableNote>Memuat pengaturan…</TableNote>
      ) : settings.error ? (
        <TableNote tone="danger">{settings.error.message}</TableNote>
      ) : settings.data ? (
        <SettingsForm key={`${branch}:${settings.dataUpdatedAt}`} branch={branch} initial={settings.data} options={options.data} />
      ) : null}
      <CategoryEditor />
    </div>
  );
}

function SettingsForm({ branch, initial, options }: { branch: string; initial: Settings; options: Options }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(initial);
  const save = useMutation({
    mutationFn: (reset: boolean) =>
      complaintsApi.saveSettings({
        branch_id: branch || null,
        sla: form.sla,
        work_start: form.work_start,
        work_end: form.work_end,
        escalation_user_id: form.escalation_user_id || null,
        escalation_phone: form.escalation_phone?.trim() || null,
        reset,
      }),
    onSuccess: (_, reset) => {
      toast.success(reset ? "Cabang kembali memakai pengaturan default" : "Pengaturan disimpan");
      void queryClient.invalidateQueries({ queryKey: COMPLAINT_KEYS.settings(branch) });
    },
  });
  const people = [...options.staff, ...options.coach_users.filter((c) => !options.staff.some((s) => s.id === c.id))];
  const rule = (p: (typeof PRIORITIES)[number], patch: Partial<Settings["sla"]["normal"]>) =>
    setForm((f) => ({ ...f, sla: { ...f.sla, [p]: { ...f.sla[p], ...patch } } }));

  return (
    <Card className="space-y-5 p-5">
      {branch && initial.inherited && (
        <p className="rounded-2xl bg-info-soft px-4 py-3 text-sm text-info">Cabang ini memakai pengaturan default. Simpan untuk membuat pengaturan sendiri.</p>
      )}
      <div>
        <h3 className="text-sm font-semibold">SLA per prioritas</h3>
        <p className="text-xs text-muted-foreground">Jam kerja saja: jam di luar jam kerja cabang tidak dihitung.</p>
      </div>
      <Table aria-label="SLA per prioritas">
        <TableHeader>
          <TableRow>
            <TableHead>Prioritas</TableHead>
            <TableHead>Respons (jam)</TableHead>
            <TableHead>Selesai (jam)</TableHead>
            <TableHead>Jam kerja saja</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {PRIORITIES.map((p) => (
            <TableRow key={p}>
              <TableCell className="font-medium">{PRIORITY_LABEL[p]}</TableCell>
              <TableCell>
                <Input
                  type="number"
                  min={1}
                  max={336}
                  className="w-24"
                  aria-label={`Respons ${PRIORITY_LABEL[p]}`}
                  value={form.sla[p].respond_hours}
                  onChange={(e) => rule(p, { respond_hours: Number(e.target.value) })}
                />
              </TableCell>
              <TableCell>
                <Input
                  type="number"
                  min={1}
                  max={336}
                  className="w-24"
                  aria-label={`Selesai ${PRIORITY_LABEL[p]}`}
                  value={form.sla[p].resolve_hours}
                  onChange={(e) => rule(p, { resolve_hours: Number(e.target.value) })}
                />
              </TableCell>
              <TableCell>
                <input
                  type="checkbox"
                  className="size-4"
                  aria-label={`Jam kerja saja ${PRIORITY_LABEL[p]}`}
                  checked={form.sla[p].business_hours}
                  onChange={(e) => rule(p, { business_hours: e.target.checked })}
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Jam kerja mulai" hint="Waktu lokal cabang. Eskalasi prioritas normal dan rendah menunggu jam ini.">
          <Input type="time" value={form.work_start} onChange={(e) => setForm({ ...form, work_start: e.target.value })} />
        </Field>
        <Field label="Jam kerja selesai">
          <Input type="time" value={form.work_end} onChange={(e) => setForm({ ...form, work_end: e.target.value })} />
        </Field>
        <Field label="Eskalasi ke (head coach atau ops)" hint="Menerima notifikasi SLA di dashboard.">
          <select className={SELECT} value={form.escalation_user_id ?? ""} onChange={(e) => setForm({ ...form, escalation_user_id: e.target.value || null })}>
            <option value="">Tidak ada</option>
            {people.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.hint ? ` · ${s.hint}` : ""}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Nomor WhatsApp eskalasi" hint="Kosong: nomor di data karyawan user eskalasi.">
          <Input inputMode="tel" value={form.escalation_phone ?? ""} onChange={(e) => setForm({ ...form, escalation_phone: e.target.value })} />
        </Field>
      </div>
      {save.error && <p className="text-sm text-danger">{save.error.message}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        {branch && !initial.inherited && (
          <Button variant="outline" disabled={save.isPending} onClick={() => save.mutate(true)}>
            Pakai pengaturan default
          </Button>
        )}
        <Button disabled={save.isPending} onClick={() => save.mutate(false)}>
          Simpan pengaturan
        </Button>
      </div>
    </Card>
  );
}

function CategoryEditor() {
  const queryClient = useQueryClient();
  const categories = useQuery({ queryKey: COMPLAINT_KEYS.categories, queryFn: complaintsApi.categories });
  const [draft, setDraft] = useState<Category[] | null>(null);
  const [added, setAdded] = useState({ code: "", label: "" });
  const list = draft ?? categories.data ?? [];
  const save = useMutation({
    mutationFn: () => complaintsApi.saveCategories(list),
    onSuccess: () => {
      toast.success("Kategori disimpan");
      setDraft(null);
      void queryClient.invalidateQueries({ queryKey: COMPLAINT_KEYS.all });
    },
  });
  const edit = (code: string, patch: Partial<Category>) => setDraft(list.map((c) => (c.code === code ? { ...c, ...patch } : c)));
  const add = () => {
    const code = added.code.trim().toLowerCase();
    if (!code || !added.label.trim() || list.some((c) => c.code === code)) return;
    setDraft([...list, { code, label: added.label.trim(), sort_order: (list.at(-1)?.sort_order ?? 0) + 10, is_active: true }]);
    setAdded({ code: "", label: "" });
  };

  return (
    <Card className="space-y-4 p-5">
      <div>
        <h3 className="text-sm font-semibold">Kategori keluhan</h3>
        <p className="text-xs text-muted-foreground">Kategori yang sudah dipakai tiket dinonaktifkan, tidak dihapus.</p>
      </div>
      {categories.isLoading ? (
        <TableNote>Memuat kategori…</TableNote>
      ) : (
        <ul className="divide-y divide-border">
          {list.map((c) => (
            <li key={c.code} className="flex items-center gap-3 py-2">
              <Input className="flex-1" aria-label={`Nama kategori ${c.code}`} value={c.label} onChange={(e) => edit(c.code, { label: e.target.value })} />
              <span className="w-36 truncate font-mono text-xs text-muted-foreground">{c.code}</span>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="size-4" checked={c.is_active} onChange={(e) => edit(c.code, { is_active: e.target.checked })} />
                Aktif
              </label>
            </li>
          ))}
        </ul>
      )}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto]">
        <Input placeholder="Kode (mis. parkir)" value={added.code} onChange={(e) => setAdded({ ...added, code: e.target.value })} />
        <Input placeholder="Nama kategori" value={added.label} onChange={(e) => setAdded({ ...added, label: e.target.value })} />
        <Button variant="outline" onClick={add}>
          Tambah
        </Button>
      </div>
      {save.error && <p className="text-sm text-danger">{save.error.message}</p>}
      <div className="flex justify-end">
        <Button disabled={!draft || save.isPending} onClick={() => save.mutate()}>
          Simpan kategori
        </Button>
      </div>
    </Card>
  );
}
