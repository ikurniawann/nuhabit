"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
import { Field, TEXTAREA } from "@/features/crm/engagement/components/shared";
import { membersApi } from "@/features/gym/members/api";
import { tanggal, jam } from "@/features/gym/scheduling/api";
import { SELECT } from "@/features/gym/shared";
import { useDebounced } from "@/features/gym/use-debounced";
import { COMPLAINT_KEYS, PRIORITIES, PRIORITY_LABEL, complaintsApi, ticketHref, type ComplaintPriority, type NewTicket } from "../api";

interface Member {
  id: string;
  name: string | null;
}

/**
 * "Buat tiket" di front desk dan halaman Keluhan. Dari profil member, member
 * sudah terisi; tanpa member, staf mencari member atau mengisi nama dan
 * nomor pelapor. Kelas yang dipilih mengisi coach dan cabang.
 */
export function NewTicketDialog({ member, onClose }: { member?: Member; onClose: () => void }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const options = useQuery({ queryKey: COMPLAINT_KEYS.options, queryFn: complaintsApi.options });
  const [picked, setPicked] = useState<Member | null>(member ?? null);
  const [search, setSearch] = useState("");
  const q = useDebounced(search, 300);
  const found = useQuery({
    queryKey: ["gym-complaints", "member-search", q],
    queryFn: () => membersApi.list(new URLSearchParams({ q, page_size: "6" }).toString()),
    enabled: !picked && q.trim().length >= 2,
  });
  const classes = useQuery({
    queryKey: COMPLAINT_KEYS.memberClasses(picked?.id ?? ""),
    queryFn: () => complaintsApi.memberClasses(picked!.id),
    enabled: !!picked,
  });
  const [form, setForm] = useState<NewTicket>({ category: "", priority: "normal", description: "", title: "" });
  const set = <K extends keyof NewTicket>(key: K, value: NewTicket[K]) => setForm((f) => ({ ...f, [key]: value }));

  const save = useMutation({
    mutationFn: () =>
      complaintsApi.create({
        ...form,
        source: "front_desk",
        customer_id: picked?.id ?? null,
        coach_id: form.coach_id || null,
        session_id: form.session_id || null,
        branch_id: form.branch_id || null,
        owner_user_id: form.owner_user_id || null,
      }),
    onSuccess: ({ id, code }) => {
      toast.success(`Tiket ${code} dibuat`);
      void queryClient.invalidateQueries({ queryKey: COMPLAINT_KEYS.all });
      router.push(ticketHref(id));
    },
  });
  const hasReporter = !!picked || !!form.contact_name?.trim() || !!form.contact_phone?.trim();
  const valid = !!form.category && !!form.description?.trim() && hasReporter;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPanel size="md">
        <DialogPanelForm
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <DialogPanelHeader>
            <DialogPanelTitle>Buat tiket keluhan</DialogPanelTitle>
            <DialogPanelDescription>Batas waktu respons dan penyelesaian mengikuti SLA prioritas di cabang tiket.</DialogPanelDescription>
          </DialogPanelHeader>
          <DialogPanelBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {picked ? (
              <Field label="Member" className="sm:col-span-2">
                <div className="flex items-center justify-between gap-2 rounded-full border border-border px-4 py-2 text-sm">
                  <span className="truncate font-medium">{picked.name ?? "Tanpa nama"}</span>
                  {!member && (
                    <button type="button" className="text-xs text-muted-foreground underline" onClick={() => setPicked(null)}>
                      Ganti
                    </button>
                  )}
                </div>
              </Field>
            ) : (
              <>
                <Field label="Cari member" hint="Nama, nomor HP, atau kode member" className="sm:col-span-2">
                  <Input value={search} onChange={(e) => setSearch(e.target.value)} autoComplete="off" />
                </Field>
                {(found.data?.rows.length ?? 0) > 0 && (
                  <ul className="divide-y divide-border rounded-2xl border border-border text-sm sm:col-span-2">
                    {found.data!.rows.map((m) => (
                      <li key={m.id}>
                        <button type="button" className="w-full px-4 py-2 text-left hover:bg-surface" onClick={() => setPicked({ id: m.id, name: m.name })}>
                          <span className="font-medium">{m.name ?? "Tanpa nama"}</span>
                          <span className="ml-2 text-muted-foreground">{m.phone}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <Field label="Nama pelapor (bukan member)">
                  <Input value={form.contact_name ?? ""} onChange={(e) => set("contact_name", e.target.value)} />
                </Field>
                <Field label="Nomor pelapor">
                  <Input value={form.contact_phone ?? ""} inputMode="tel" onChange={(e) => set("contact_phone", e.target.value)} />
                </Field>
              </>
            )}
            <Field label="Kategori">
              <select className={SELECT} value={form.category} onChange={(e) => set("category", e.target.value)} required>
                <option value="">Pilih kategori</option>
                {options.data?.categories.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Prioritas">
              <select className={SELECT} value={form.priority} onChange={(e) => set("priority", e.target.value as ComplaintPriority)}>
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {PRIORITY_LABEL[p]}
                  </option>
                ))}
              </select>
            </Field>
            {picked && (
              <Field label="Kelas terkait (opsional)" hint="30 hari terakhir sampai 7 hari ke depan" className="sm:col-span-2">
                <select
                  className={SELECT}
                  value={form.session_id ?? ""}
                  onChange={(e) => {
                    const c = classes.data?.find((x) => x.session_id === e.target.value);
                    setForm((f) => ({ ...f, session_id: e.target.value || null, coach_id: c?.coach_id ?? f.coach_id }));
                  }}
                >
                  <option value="">Tidak terkait kelas</option>
                  {classes.data?.map((c) => (
                    <option key={c.session_id} value={c.session_id}>
                      {c.name} · {tanggal(c.starts_at, c.timezone)} {jam(c.starts_at, c.timezone)}
                      {c.coach_name ? ` · ${c.coach_name}` : ""}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <Field label="Coach (opsional)">
              <select className={SELECT} value={form.coach_id ?? ""} onChange={(e) => set("coach_id", e.target.value || null)}>
                <option value="">Tidak terkait coach</option>
                {options.data?.coaches.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Cabang" hint="Kosong: diambil dari kelas, coach, atau kelas terakhir member">
              <select className={SELECT} value={form.branch_id ?? ""} onChange={(e) => set("branch_id", e.target.value || null)}>
                <option value="">Otomatis</option>
                {options.data?.branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Judul (opsional)" className="sm:col-span-2">
              <Input value={form.title ?? ""} maxLength={120} onChange={(e) => set("title", e.target.value)} placeholder="Diisi dari keluhan bila kosong" />
            </Field>
            <Field label="Keluhan" className="sm:col-span-2">
              <textarea className={TEXTAREA} value={form.description ?? ""} maxLength={2000} required onChange={(e) => set("description", e.target.value)} />
            </Field>
            <Field label="PIC (opsional)" className="sm:col-span-2">
              <select className={SELECT} value={form.owner_user_id ?? ""} onChange={(e) => set("owner_user_id", e.target.value || null)}>
                <option value="">Belum ditentukan</option>
                {options.data?.staff.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
            {save.error && (
              <p role="alert" className="rounded-2xl bg-danger-soft px-4 py-3 text-sm text-danger sm:col-span-2">
                {save.error.message}
              </p>
            )}
          </DialogPanelBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Batal
            </Button>
            <Button type="submit" disabled={!valid || save.isPending}>
              Buat tiket
            </Button>
          </DialogFooter>
        </DialogPanelForm>
      </DialogPanel>
    </Dialog>
  );
}
