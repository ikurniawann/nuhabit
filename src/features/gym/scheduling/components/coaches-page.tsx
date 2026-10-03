"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Field, TableNote, TEXTAREA } from "@/features/crm/engagement/components/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
import { PageHeader } from "@/components/ui/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { angka, GYM_KEYS, schedulingApi, SELECT, type Coach } from "../api";

/** Gym → Coach: profil yang tampil di portal member dan jadwal kelas. */
export function CoachesPage() {
  const queryClient = useQueryClient();
  const coaches = useQuery({ queryKey: GYM_KEYS.coaches, queryFn: schedulingApi.coaches });
  const [editing, setEditing] = useState<Coach | "new" | null>(null);
  const rows = coaches.data ?? [];

  return (
    <div className="space-y-4">
      <PageHeader
        kicker="Gym & Kelas"
        title="Coach"
        description="Profil coach tampil di portal member beserta kelas mendatangnya. Coach nonaktif tidak bisa dipilih untuk sesi baru."
        actions={
          <Button onClick={() => setEditing("new")}>
            <Plus /> Coach baru
          </Button>
        }
      />

      <Card className="py-0">
        {coaches.isLoading ? (
          <TableNote>Memuat coach…</TableNote>
        ) : coaches.error ? (
          <TableNote tone="danger">{coaches.error.message}</TableNote>
        ) : rows.length === 0 ? (
          <TableNote>Belum ada coach.</TableNote>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Coach</TableHead>
                <TableHead className="hidden md:table-cell">Spesialisasi</TableHead>
                <TableHead className="text-right">Kelas 14 hari</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Kelas selesai</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((c) => (
                <TableRow key={c.id} className={c.status === "inactive" ? "opacity-60" : undefined}>
                  <TableCell className="max-w-[18rem] whitespace-normal">
                    <p className="flex items-center gap-2 font-medium">
                      {c.name}
                      {c.status === "inactive" && <Badge variant="muted">Nonaktif</Badge>}
                    </p>
                    <p className="text-xs text-muted-foreground md:hidden">{c.specialization}</p>
                    <p className="line-clamp-2 text-xs text-muted-foreground">{c.bio}</p>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">{c.specialization || "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{angka(c.upcoming_sessions)}</TableCell>
                  <TableCell className="hidden text-right tabular-nums sm:table-cell">{angka(c.completed_sessions)}</TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" onClick={() => setEditing(c)}>
                      Ubah
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {editing && (
        <CoachDialog
          coach={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => void queryClient.invalidateQueries({ queryKey: GYM_KEYS.coaches })}
        />
      )}
    </div>
  );
}

function CoachDialog({ coach, onClose, onSaved }: { coach: Coach | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    name: coach?.name ?? "",
    specialization: coach?.specialization ?? "",
    bio: coach?.bio ?? "",
    photo_url: coach?.photo_url ?? "",
    status: coach?.status ?? ("active" as const),
  });
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((cur) => ({ ...cur, [key]: e.target.value }));
  const save = useMutation({
    mutationFn: () =>
      schedulingApi.saveCoach(
        {
          name: form.name.trim(),
          specialization: form.specialization.trim(),
          bio: form.bio.trim(),
          photo_url: form.photo_url.trim() || null,
          status: form.status,
        },
        coach?.id
      ),
    onSuccess: () => {
      toast.success("Coach disimpan", { description: form.name });
      onSaved();
      onClose();
    },
    onError: (error) => toast.error("Coach gagal disimpan", { description: error.message }),
  });

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
            <DialogPanelTitle>{coach ? `Ubah ${coach.name}` : "Coach baru"}</DialogPanelTitle>
            <DialogPanelDescription>Bio dan spesialisasi tampil di profil coach pada portal member.</DialogPanelDescription>
          </DialogPanelHeader>
          <DialogPanelBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Nama">
              <Input value={form.name} onChange={set("name")} placeholder="Rizky Ramadhan" required />
            </Field>
            <Field label="Spesialisasi">
              <Input value={form.specialization} onChange={set("specialization")} placeholder="HYROX race coach" />
            </Field>
            <Field label="Bio" className="sm:col-span-2">
              <textarea className={TEXTAREA} value={form.bio} onChange={set("bio")} />
            </Field>
            <Field label="URL foto">
              <Input type="url" value={form.photo_url} onChange={set("photo_url")} placeholder="https://…" />
            </Field>
            <Field label="Status">
              <select className={SELECT} value={form.status} onChange={set("status")}>
                <option value="active">Aktif</option>
                <option value="inactive">Nonaktif</option>
              </select>
            </Field>
          </DialogPanelBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Batal
            </Button>
            <Button type="submit" disabled={form.name.trim().length < 3 || save.isPending}>
              Simpan
            </Button>
          </DialogFooter>
        </DialogPanelForm>
      </DialogPanel>
    </Dialog>
  );
}
