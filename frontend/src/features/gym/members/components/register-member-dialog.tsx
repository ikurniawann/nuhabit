"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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
import { MEMBER_KEYS, MemberApiError, membersApi } from "../api";
import { MemberLink, memberHref } from "../member-link";

/** "Tambah member" di front desk: nama, nomor HP, email. Nomor atau email ganda ditolak beserta pemiliknya. */
export function RegisterMemberDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ name: "", phone: "", email: "" });
  const save = useMutation({
    mutationFn: () => membersApi.register(form),
    onSuccess: ({ id }) => {
      toast.success("Member terdaftar", { description: form.name.trim() });
      void queryClient.invalidateQueries({ queryKey: MEMBER_KEYS.all });
      router.push(memberHref(id));
    },
  });
  const error = save.error instanceof MemberApiError ? save.error : null;
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => {
    save.reset();
    setForm({ ...form, [key]: e.target.value });
  };
  const valid = form.name.trim().length >= 2 && form.phone.replace(/\D/g, "").length >= 10;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPanel size="sm">
        <DialogPanelForm
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <DialogPanelHeader>
            <DialogPanelTitle>Tambah member</DialogPanelTitle>
            <DialogPanelDescription>
              Member bisa langsung masuk ke aplikasi member dengan nomor HP ini lewat kode WhatsApp.
            </DialogPanelDescription>
          </DialogPanelHeader>
          <DialogPanelBody className="grid grid-cols-1 gap-4">
            <Field label="Nama lengkap">
              <Input value={form.name} onChange={set("name")} autoComplete="off" required aria-invalid={error?.field === "name"} />
            </Field>
            <Field label="Nomor HP (WhatsApp)" hint="Contoh: 0812 3456 7890">
              <Input
                value={form.phone}
                onChange={set("phone")}
                inputMode="tel"
                autoComplete="off"
                required
                aria-invalid={error?.field === "phone"}
              />
            </Field>
            <Field label="Email (opsional)">
              <Input type="email" value={form.email} onChange={set("email")} autoComplete="off" aria-invalid={error?.field === "email"} />
            </Field>
            {save.error && (
              <div role="alert" className="rounded-2xl bg-danger-soft px-4 py-3 text-sm text-danger">
                <p>{save.error.message}</p>
                {error?.memberId && (
                  <p className="mt-1">
                    <MemberLink id={error.memberId} name="Buka profil member ini" className="text-danger underline" />
                  </p>
                )}
              </div>
            )}
          </DialogPanelBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Batal
            </Button>
            <Button type="submit" disabled={!valid || save.isPending}>
              Daftarkan
            </Button>
          </DialogFooter>
        </DialogPanelForm>
      </DialogPanel>
    </Dialog>
  );
}
