"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Field, TEXTAREA } from "@/features/crm/engagement/components/shared";
import { SELECT } from "@/features/gym/shared";
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
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { CARE_KEYS, careApi, type MemberFlag, type ReviewDecision } from "../api";
import { CATEGORY_LABEL, defaultExpiry, FLAG_NOTE_MAX, jakartaToday, REVIEW_DECISIONS } from "../display";

/** Muat ulang semua data penanda (roster, 360, daftar). */
export function useRefreshCare() {
  const queryClient = useQueryClient();
  return () => void queryClient.invalidateQueries({ queryKey: CARE_KEYS.all });
}

/**
 * Tambah penanda untuk satu member. Jenis medis hanya bisa dicatat coach
 * member ini atau manajer gym; server menolak yang lain.
 */
export function AddFlagDialog({ customerId, onClose }: { customerId: string; onClose: () => void }) {
  const refresh = useRefreshCare();
  const types = useQuery({ queryKey: CARE_KEYS.types(false), queryFn: () => careApi.types() });
  const usable = (types.data ?? []).filter((t) => !t.is_system);
  const [typeId, setTypeId] = useState("");
  const [note, setNote] = useState("");
  const [expires, setExpires] = useState<string | null>(null);
  const type = usable.find((t) => t.id === typeId);
  const today = jakartaToday();
  // Tanpa pilihan user, tanggal berakhir mengikuti bawaan jenisnya.
  const expiry = expires ?? (type ? defaultExpiry(today, type.default_expiry_days) : "");

  const save = useMutation({
    mutationFn: () => careApi.addFlag({ customer_id: customerId, type_id: typeId, note: note.trim(), expires_on: expiry || null }),
    onSuccess: () => {
      toast.success("Penanda ditambahkan");
      refresh();
      onClose();
    },
    onError: (error) => toast.error("Penanda gagal disimpan", { description: error.message }),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPanel size="sm">
        <DialogPanelForm
          onSubmit={(e) => {
            e.preventDefault();
            if (typeId) save.mutate();
          }}
        >
          <DialogPanelHeader>
            <DialogPanelTitle>Tambah penanda</DialogPanelTitle>
            <DialogPanelDescription>
              Penanda tampil di roster kelas, PT dan check-in. Detail penanda medis hanya terlihat oleh coach member ini dan manajer gym.
            </DialogPanelDescription>
          </DialogPanelHeader>
          <DialogPanelBody className="space-y-4">
            <Field label="Jenis penanda">
              <select
                className={SELECT}
                value={typeId}
                onChange={(e) => {
                  setTypeId(e.target.value);
                  setExpires(null);
                }}
                required
              >
                <option value="">Pilih jenis</option>
                {usable.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label} ({CATEGORY_LABEL[t.category].toLowerCase()})
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Catatan" hint={`${note.length}/${FLAG_NOTE_MAX}`}>
              <textarea
                className={TEXTAREA}
                value={note}
                maxLength={FLAG_NOTE_MAX}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Contoh: lutut kiri, hindari lunge dan box jump."
              />
            </Field>
            <Field label="Berlaku sampai" hint="Kosongkan bila tidak ada batas.">
              <Input type="date" min={today} value={expiry} onChange={(e) => setExpires(e.target.value)} />
            </Field>
          </DialogPanelBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Batal
            </Button>
            <Button type="submit" disabled={!typeId || save.isPending}>
              Simpan
            </Button>
          </DialogFooter>
        </DialogPanelForm>
      </DialogPanel>
    </Dialog>
  );
}

/**
 * Tinjau penanda medis: aman (penanda dihapus), batasi latihan, atau perlu
 * surat dokter. Penanda dari PAR-Q menampilkan jawaban "ya" member.
 */
export function ReviewFlagDialog({ flag, onClose }: { flag: MemberFlag; onClose: () => void }) {
  const refresh = useRefreshCare();
  const [decision, setDecision] = useState<ReviewDecision | "">("");
  const [note, setNote] = useState(flag.review_note);
  const parq = useQuery({
    queryKey: CARE_KEYS.parq(flag.customer_id),
    queryFn: () => careApi.parq(flag.customer_id),
    enabled: flag.source === "parq",
  });
  const save = useMutation({
    mutationFn: () => careApi.review(flag.id, { decision: decision as ReviewDecision, note: note.trim() }),
    onSuccess: () => {
      toast.success(decision === "cleared" ? "Member dinyatakan aman, penanda dihapus" : "Tinjauan disimpan");
      refresh();
      onClose();
    },
    onError: (error) => toast.error("Tinjauan gagal disimpan", { description: error.message }),
  });
  const last = parq.data?.last;
  const yes = last ? (parq.data?.questions ?? []).filter((q) => last.answers[q.code]) : [];

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPanel size="sm">
        <DialogPanelForm
          onSubmit={(e) => {
            e.preventDefault();
            if (decision) save.mutate();
          }}
        >
          <DialogPanelHeader>
            <DialogPanelTitle>Tinjau {flag.type_label}</DialogPanelTitle>
            <DialogPanelDescription>{flag.customer_name ?? "Member"}</DialogPanelDescription>
          </DialogPanelHeader>
          <DialogPanelBody className="space-y-4">
            {flag.note && <p className="rounded-2xl bg-surface-2 px-4 py-3 text-sm whitespace-pre-line">{flag.note}</p>}
            {last && (
              <div className="space-y-1 text-sm">
                <p className="font-semibold">PAR-Q {formatDate(last.submitted_at)}</p>
                {yes.length === 0 ? (
                  <p className="text-muted-foreground">Semua jawaban terakhir &quot;tidak&quot;.</p>
                ) : (
                  <ul className="list-disc space-y-0.5 pl-5">
                    {yes.map((q) => (
                      <li key={q.code}>Ya: {q.short}</li>
                    ))}
                  </ul>
                )}
                {last.details && <p className="text-muted-foreground">Keterangan: {last.details}</p>}
              </div>
            )}
            <fieldset className="space-y-2">
              <legend className="mb-1 text-sm font-semibold">Hasil tinjauan</legend>
              {REVIEW_DECISIONS.map((d) => (
                <label
                  key={d.value}
                  className={cn(
                    "flex cursor-pointer items-start gap-3 rounded-2xl border px-4 py-3 text-sm",
                    decision === d.value ? "border-forest bg-surface-2" : "border-border",
                  )}
                >
                  <input
                    type="radio"
                    name="decision"
                    className="mt-0.5 accent-[var(--color-forest)]"
                    checked={decision === d.value}
                    onChange={() => setDecision(d.value)}
                  />
                  <span>
                    <span className="block font-medium">{d.label}</span>
                    <span className="block text-xs text-muted-foreground">{d.hint}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            <Field label="Catatan tinjauan" hint={`${note.length}/${FLAG_NOTE_MAX}`}>
              <textarea
                className={TEXTAREA}
                value={note}
                maxLength={FLAG_NOTE_MAX}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Contoh: tanpa sprint dan burpee sampai ada surat dokter."
              />
            </Field>
          </DialogPanelBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Batal
            </Button>
            <Button type="submit" disabled={!decision || save.isPending}>
              Simpan tinjauan
            </Button>
          </DialogFooter>
        </DialogPanelForm>
      </DialogPanel>
    </Dialog>
  );
}
