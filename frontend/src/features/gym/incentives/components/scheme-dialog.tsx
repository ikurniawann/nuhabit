"use client";

import { useReducer } from "react";
import { useMutation } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Field } from "@/features/crm/engagement/components/shared";
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
import type { SchemeRow } from "@/lib/gym/incentive-server";
import { incentivesApi, type NamedOption } from "../api";
import {
  initialSchemeForm,
  isSchemeFormValid,
  schemeFormReducer,
  toSchemeInput,
  usedClassTypes,
  type SchemeTextField,
} from "../scheme-form";

/** Form skema honor (default organisasi atau khusus coach) beserta tarif per jenis kelas. */
export function SchemeDialog({
  scheme,
  coaches,
  classTypes,
  onClose,
  onSaved,
}: {
  scheme: SchemeRow | null;
  coaches: NamedOption[];
  classTypes: NamedOption[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const isDefault = scheme?.isDefault ?? false;
  const [form, dispatch] = useReducer(schemeFormReducer, scheme, initialSchemeForm);
  const set = (key: SchemeTextField) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    dispatch({ type: "field", key, value: e.target.value });

  const save = useMutation({
    mutationFn: () => incentivesApi.saveScheme(toSchemeInput(form, scheme?.id, isDefault)),
    onSuccess: () => {
      toast.success("Skema disimpan", { description: form.name });
      onSaved();
      onClose();
    },
    onError: (error) => toast.error("Skema gagal disimpan", { description: error.message }),
  });

  const usedTypes = usedClassTypes(form);

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
            <DialogPanelTitle>{scheme ? `Ubah ${scheme.name}` : "Skema khusus coach"}</DialogPanelTitle>
            <DialogPanelDescription>
              Per kelas selesai: honor sesi + hadir × per peserta + bonus bila hadir mencapai ambang kapasitas, dikurangi
              no-show. Baris tidak pernah di bawah Rp 0.
            </DialogPanelDescription>
          </DialogPanelHeader>
          <DialogPanelBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Nama skema">
              <Input value={form.name} onChange={set("name")} placeholder="Skema Rizky" required />
            </Field>
            {isDefault ? (
              <Field label="Berlaku untuk">
                <Input value="Semua coach tanpa skema sendiri" disabled />
              </Field>
            ) : (
              <Field label="Coach">
                <select className={SELECT} value={form.coach_id} onChange={set("coach_id")} required>
                  <option value="">Pilih coach…</option>
                  {coaches.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <Field label="Honor per sesi (Rp)">
              <Input type="number" min={0} value={form.session_fee_idr} onChange={set("session_fee_idr")} />
            </Field>
            <Field label="Per peserta hadir (Rp)">
              <Input type="number" min={0} value={form.per_attendee_idr} onChange={set("per_attendee_idr")} />
            </Field>
            <Field label="Bonus kelas penuh (Rp)">
              <Input type="number" min={0} value={form.full_class_bonus_idr} onChange={set("full_class_bonus_idr")} />
            </Field>
            <Field label="Ambang kelas penuh (%)" hint="Hadir ÷ kapasitas.">
              <Input
                type="number"
                min={0}
                max={100}
                value={form.full_class_threshold_percent}
                onChange={set("full_class_threshold_percent")}
              />
            </Field>
            <Field label="Potongan per no-show (Rp)">
              <Input type="number" min={0} value={form.no_show_penalty_idr} onChange={set("no_show_penalty_idr")} />
            </Field>
            {!isDefault && (
              <label className="flex items-center gap-2 self-end pb-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4 accent-forest"
                  checked={form.is_active}
                  onChange={(e) => dispatch({ type: "active", value: e.target.checked })}
                />
                Aktif (nonaktif = coach memakai skema default)
              </label>
            )}

            <div className="space-y-2 sm:col-span-2">
              <p className="text-sm font-medium">Tarif per jenis kelas</p>
              <p className="text-xs text-muted-foreground">
                Mengganti honor sesi dan per peserta untuk jenis kelas tertentu, mis. Race Simulation yang lebih panjang.
              </p>
              {form.rates.map((rate, index) => (
                <div
                  key={index}
                  className="grid grid-cols-1 gap-2 rounded-2xl bg-surface-2 p-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto]"
                >
                  <select
                    className={SELECT}
                    value={rate.class_type_id}
                    aria-label="Jenis kelas"
                    onChange={(e) => dispatch({ type: "rate", index, patch: { class_type_id: e.target.value } })}
                  >
                    <option value="">Pilih jenis kelas…</option>
                    {classTypes.map((c) => (
                      <option key={c.id} value={c.id} disabled={c.id !== rate.class_type_id && usedTypes.includes(c.id)}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <Input
                    type="number"
                    min={0}
                    aria-label="Honor sesi"
                    value={rate.session_fee_idr}
                    onChange={(e) => dispatch({ type: "rate", index, patch: { session_fee_idr: e.target.value } })}
                  />
                  <Input
                    type="number"
                    min={0}
                    aria-label="Per peserta"
                    value={rate.per_attendee_idr}
                    onChange={(e) => dispatch({ type: "rate", index, patch: { per_attendee_idr: e.target.value } })}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-danger"
                    aria-label="Hapus tarif"
                    onClick={() => dispatch({ type: "removeRate", index })}
                  >
                    <Trash2 />
                  </Button>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" onClick={() => dispatch({ type: "addRate" })}>
                <Plus /> Tambah tarif
              </Button>
            </div>
          </DialogPanelBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Batal
            </Button>
            <Button type="submit" disabled={!isSchemeFormValid(form, isDefault) || save.isPending}>
              Simpan skema
            </Button>
          </DialogFooter>
        </DialogPanelForm>
      </DialogPanel>
    </Dialog>
  );
}
