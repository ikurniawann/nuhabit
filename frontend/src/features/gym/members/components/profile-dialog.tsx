"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
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
import { Field } from "@/features/crm/engagement/components/shared";
import { MEMBER_KEYS, MemberApiError, membersApi, type MemberProfile } from "../api";
import { MemberLink } from "../member-link";

/** Ubah profil dan kontak member. Kontak darurat diisi lengkap atau dikosongkan semua. */
export function ProfileDialog({ profile, onClose }: { profile: MemberProfile; onClose: () => void }) {
  const queryClient = useQueryClient();
  const contact = profile.emergency_contact;
  const [form, setForm] = useState({
    name: profile.name ?? "",
    phone: profile.phone,
    email: profile.email ?? "",
    birth_date: profile.birth_date ?? "",
    contact_name: contact?.name ?? "",
    contact_phone: contact?.phone ?? "",
    contact_relation: contact?.relation ?? "",
  });
  const contactParts = [form.contact_name, form.contact_phone, form.contact_relation].map((v) => v.trim());
  const contactFilled = contactParts.every(Boolean);
  const contactPartial = !contactFilled && contactParts.some(Boolean);

  const save = useMutation({
    mutationFn: () =>
      membersApi.update(profile.id, {
        name: form.name,
        phone: form.phone,
        email: form.email,
        birth_date: form.birth_date,
        emergency_contact: contactFilled
          ? { name: contactParts[0], phone: contactParts[1], relation: contactParts[2] }
          : null,
      }),
    onSuccess: () => {
      toast.success("Profil member disimpan");
      void queryClient.invalidateQueries({ queryKey: MEMBER_KEYS.all });
      onClose();
    },
  });
  const error = save.error instanceof MemberApiError ? save.error : null;
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => {
    save.reset();
    setForm({ ...form, [key]: e.target.value });
  };

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
            <DialogPanelTitle>Ubah profil</DialogPanelTitle>
            <DialogPanelDescription>Nomor HP dipakai member untuk masuk ke aplikasi; pastikan masih aktif di WhatsApp.</DialogPanelDescription>
          </DialogPanelHeader>
          <DialogPanelBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Nama lengkap" className="sm:col-span-2">
              <Input value={form.name} onChange={set("name")} required aria-invalid={error?.field === "name"} />
            </Field>
            <Field label="Nomor HP (WhatsApp)">
              <Input value={form.phone} onChange={set("phone")} inputMode="tel" required aria-invalid={error?.field === "phone"} />
            </Field>
            <Field label="Email">
              <Input type="email" value={form.email} onChange={set("email")} aria-invalid={error?.field === "email"} />
            </Field>
            <Field label="Tanggal lahir">
              <Input type="date" value={form.birth_date} onChange={set("birth_date")} aria-invalid={error?.field === "birth_date"} />
            </Field>
            <fieldset className="grid grid-cols-1 gap-4 sm:col-span-2 sm:grid-cols-3">
              <legend className="mb-2 text-sm font-semibold">Kontak darurat</legend>
              <Field label="Nama">
                <Input value={form.contact_name} onChange={set("contact_name")} />
              </Field>
              <Field label="Nomor HP">
                <Input value={form.contact_phone} onChange={set("contact_phone")} inputMode="tel" />
              </Field>
              <Field label="Hubungan" hint="Contoh: Istri, Kakak">
                <Input value={form.contact_relation} onChange={set("contact_relation")} />
              </Field>
            </fieldset>
            {contactPartial && (
              <p className="text-sm text-warning sm:col-span-2">Lengkapi ketiga isian kontak darurat, atau kosongkan semuanya.</p>
            )}
            {save.error && (
              <div role="alert" className="rounded-2xl bg-danger-soft px-4 py-3 text-sm text-danger sm:col-span-2">
                <p>{save.error.message}</p>
                {error?.memberId && (
                  <MemberLink id={error.memberId} name="Buka profil member tersebut" className="text-danger underline" />
                )}
              </div>
            )}
          </DialogPanelBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Batal
            </Button>
            <Button type="submit" disabled={save.isPending || contactPartial || form.name.trim().length < 2}>
              Simpan
            </Button>
          </DialogFooter>
        </DialogPanelForm>
      </DialogPanel>
    </Dialog>
  );
}
