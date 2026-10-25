"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, FileText, Plus } from "lucide-react";
import { toast } from "sonner";
import { Field, TableNote, TEXTAREA } from "@/features/crm/engagement/components/shared";
import { useCan } from "@/components/iam/iam-access-provider";
import { Can } from "@/components/iam/can";
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
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatDateTime, formatNumber } from "@/lib/format";
import { SOP_KEYS, sopApi, type SopDetail, type SopDocument } from "../api";
import { MySopList, SopBody } from "./sop-reader";

/** Gym → SOP Coach. Manajer mengelola dokumen; coach membaca dan mengonfirmasi miliknya. */
export function SopPage() {
  const manager = useCan("gym.sop", "read");
  return (
    <div className="space-y-4">
      <PageHeader
        kicker="Gym & Kelas"
        title="SOP Coach"
        description={
          manager
            ? "Setiap versi baru wajib dibaca dan dikonfirmasi ulang oleh semua coach, atau role yang dipilih. Pantau siapa yang belum membaca dan kirim pengingat."
            : "SOP yang wajib kamu baca. Konfirmasi setiap versi baru."
        }
      />
      {manager ? <SopManager /> : <MySopList />}
    </div>
  );
}

function SopManager() {
  const list = useQuery({ queryKey: SOP_KEYS.list, queryFn: sopApi.list });
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const rows = list.data ?? [];
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Can menu="gym.sop" action="create" mode="disable">
          <Button onClick={() => setCreating(true)}>
            <Plus /> SOP baru
          </Button>
        </Can>
      </div>
      <Card className="py-0">
        {list.isLoading ? (
          <TableNote>Memuat SOP…</TableNote>
        ) : list.error ? (
          <TableNote tone="danger">{list.error.message}</TableNote>
        ) : rows.length === 0 ? (
          <TableNote>Belum ada SOP. Terbitkan SOP pertama untuk coach.</TableNote>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>SOP</TableHead>
                <TableHead>Sudah membaca</TableHead>
                <TableHead className="hidden md:table-cell">Pembaca</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((d) => (
                <TableRow key={d.id} className={d.is_active ? undefined : "opacity-60"}>
                  <TableCell className="whitespace-normal">
                    <p className="font-medium">{d.title}</p>
                    <p className="text-xs text-muted-foreground">
                      Versi {d.version} · {formatDate(d.published_at)}
                      {!d.is_active && " · nonaktif"}
                    </p>
                  </TableCell>
                  <TableCell className="min-w-40">
                    <ReadProgress doc={d} />
                  </TableCell>
                  <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                    {d.audience_roles.length === 0 ? "Semua coach aktif" : d.audience_roles.join(", ")}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="ghost" onClick={() => setOpenId(d.id)}>
                      Buka
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
      {creating && <VersionDialog onClose={() => setCreating(false)} />}
      {openId && <SopDetailDialog id={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}

function ReadProgress({ doc }: { doc: Pick<SopDocument, "readers_acked" | "readers_total"> }) {
  const pct = doc.readers_total ? Math.round((doc.readers_acked / doc.readers_total) * 100) : 0;
  return (
    <div className="space-y-1">
      <Progress value={pct} />
      <p className="text-xs text-muted-foreground tabular-nums">
        {formatNumber(doc.readers_acked)}/{formatNumber(doc.readers_total)} pembaca
      </p>
    </div>
  );
}

function SopDetailDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const detail = useQuery({ queryKey: SOP_KEYS.detail(id), queryFn: () => sopApi.get(id) });
  const [publishing, setPublishing] = useState(false);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: SOP_KEYS.all });
  const remind = useMutation({
    mutationFn: () => sopApi.remind(id),
    onSuccess: (r) => {
      toast.success(r.sent ? `Pengingat terkirim ke ${formatNumber(r.sent)} orang` : "Semua yang belum membaca sudah diingatkan hari ini", {
        description: r.skipped ? `${formatNumber(r.skipped)} sudah diingatkan hari ini.` : undefined,
      });
      refresh();
    },
    onError: (error) => toast.error("Pengingat gagal dikirim", { description: error.message }),
  });
  const toggle = useMutation({
    mutationFn: (active: boolean) => sopApi.update(id, { is_active: active }),
    onSuccess: () => refresh(),
    onError: (error) => toast.error("SOP gagal diubah", { description: error.message }),
  });
  const d = detail.data;
  const unread = d ? d.readers.filter((r) => !r.acknowledged_at).length : 0;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPanel size="lg">
        <DialogPanelHeader>
          <DialogPanelTitle>{d?.title ?? "SOP"}</DialogPanelTitle>
          {d && (
            <DialogPanelDescription>
              Versi {d.version}, terbit {formatDateTime(d.published_at)}
              {d.remind_after_days > 0 ? ` · pengingat otomatis setiap ${d.remind_after_days} hari` : " · pengingat manual saja"}
            </DialogPanelDescription>
          )}
        </DialogPanelHeader>
        <DialogPanelBody className="space-y-5">
          {detail.isLoading ? (
            <p className="text-sm text-muted-foreground">Memuat SOP…</p>
          ) : detail.error || !d ? (
            <p className="text-sm text-danger">{detail.error?.message ?? "SOP tidak ditemukan"}</p>
          ) : (
            <>
              <ReadProgress doc={d} />
              <div className="flex flex-wrap gap-2">
                <Can menu="gym.sop" action="update">
                  <Button size="sm" variant="soft" disabled={!d.is_active || unread === 0 || remind.isPending} onClick={() => remind.mutate()}>
                    <BellRing /> Ingatkan yang belum ({formatNumber(unread)})
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setPublishing(true)}>
                    Terbitkan versi baru
                  </Button>
                  <Button size="sm" variant="ghost" disabled={toggle.isPending} onClick={() => toggle.mutate(!d.is_active)}>
                    {d.is_active ? "Nonaktifkan" : "Aktifkan"}
                  </Button>
                </Can>
              </div>
              <Readers detail={d} />
              <section className="space-y-2">
                <h3 className="text-sm font-semibold">Isi versi {d.version}</h3>
                {d.body && <SopBody body={d.body} />}
                {d.attachment_name && (
                  <a
                    href={sopApi.fileUrl(d.version_id)}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-2 text-sm font-medium text-forest hover:underline"
                  >
                    <FileText className="size-4" aria-hidden /> {d.attachment_name}
                  </a>
                )}
              </section>
              <section className="space-y-2">
                <h3 className="text-sm font-semibold">Riwayat versi</h3>
                <ul className="divide-y divide-border text-sm">
                  {d.versions.map((v) => (
                    <li key={v.id} className="flex flex-wrap justify-between gap-2 py-2">
                      <span>
                        Versi {v.version} · {formatDate(v.published_at)}
                        {v.published_by_name && ` · ${v.published_by_name}`}
                        {v.change_note && <span className="block text-xs text-muted-foreground">{v.change_note}</span>}
                      </span>
                      <span className="text-xs text-muted-foreground tabular-nums">{formatNumber(v.acked)} konfirmasi</span>
                    </li>
                  ))}
                </ul>
              </section>
            </>
          )}
        </DialogPanelBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Tutup
          </Button>
        </DialogFooter>
      </DialogPanel>
      {publishing && d && <VersionDialog doc={d} onClose={() => setPublishing(false)} />}
    </Dialog>
  );
}

function Readers({ detail }: { detail: SopDetail }) {
  if (detail.readers.length === 0) {
    return <p className="text-sm text-muted-foreground">Belum ada pembaca: tidak ada coach aktif atau staf dengan role terpilih.</p>;
  }
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold">Status baca versi {detail.version}</h3>
      <ul className="divide-y divide-border rounded-2xl border border-border text-sm">
        {detail.readers.map((r) => (
          <li key={r.user_id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
            <span className="min-w-0">
              <span className="block truncate font-medium">{r.name}</span>
              {!r.acknowledged_at && r.last_reminded_at && (
                <span className="block text-xs text-muted-foreground">Diingatkan {formatDateTime(r.last_reminded_at)}</span>
              )}
            </span>
            {r.acknowledged_at ? (
              <Badge variant="success">Dikonfirmasi {formatDate(r.acknowledged_at)}</Badge>
            ) : (
              <Badge variant="warning">Belum membaca</Badge>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** SOP baru (tanpa doc) atau versi baru dari SOP yang ada. */
function VersionDialog({ doc, onClose }: { doc?: SopDetail; onClose: () => void }) {
  const queryClient = useQueryClient();
  const roles = useQuery({ queryKey: SOP_KEYS.roles, queryFn: sopApi.roles, enabled: !doc });
  const [title, setTitle] = useState(doc?.title ?? "");
  const [body, setBody] = useState(doc?.body ?? "");
  const [changeNote, setChangeNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [keepFile, setKeepFile] = useState(Boolean(doc?.attachment_name));
  const [audience, setAudience] = useState<string[]>([]);
  const [remindDays, setRemindDays] = useState("3");

  const save = useMutation({
    mutationFn: (): Promise<unknown> => {
      const form = new FormData();
      form.set("title", title.trim());
      form.set("body", body);
      form.set("change_note", changeNote.trim());
      if (file) form.set("file", file);
      if (doc) {
        if (keepFile) form.set("keep_attachment", "1");
        return sopApi.publish(doc.id, form);
      }
      form.set("audience_roles", audience.join(","));
      form.set("remind_after_days", remindDays || "0");
      return sopApi.create(form);
    },
    onSuccess: () => {
      toast.success(doc ? "Versi baru diterbitkan. Semua pembaca diminta konfirmasi ulang." : "SOP diterbitkan");
      void queryClient.invalidateQueries({ queryKey: SOP_KEYS.all });
      onClose();
    },
    onError: (error) => toast.error("SOP gagal diterbitkan", { description: error.message }),
  });
  const valid = title.trim().length > 0 && (body.trim().length > 0 || file !== null || (doc && keepFile));

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPanel size="lg">
        <DialogPanelForm
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) save.mutate();
          }}
        >
          <DialogPanelHeader>
            <DialogPanelTitle>{doc ? `Versi baru ${doc.title}` : "SOP baru"}</DialogPanelTitle>
            <DialogPanelDescription>
              Isi berupa teks (markdown sederhana: # judul, - daftar, **tebal**), lampiran PDF, atau keduanya. Versi yang sudah terbit tidak
              bisa diubah.
            </DialogPanelDescription>
          </DialogPanelHeader>
          <DialogPanelBody className="space-y-4">
            <Field label="Judul">
              <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={150} required />
            </Field>
            <Field label="Isi">
              <textarea className={`${TEXTAREA} min-h-56 font-mono`} value={body} onChange={(e) => setBody(e.target.value)} maxLength={50_000} />
            </Field>
            <Field label="Lampiran PDF" hint="Maksimal 10 MB.">
              <Input type="file" accept="application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </Field>
            {doc?.attachment_name && !file && (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-[var(--color-forest)]"
                  checked={keepFile}
                  onChange={(e) => setKeepFile(e.target.checked)}
                />
                Pakai lagi lampiran {doc.attachment_name}
              </label>
            )}
            <Field label="Catatan perubahan" hint="Tampil untuk pembaca, misalnya bagian yang berubah.">
              <Input value={changeNote} onChange={(e) => setChangeNote(e.target.value)} maxLength={300} />
            </Field>
            {!doc && (
              <>
                <fieldset className="space-y-2">
                  <legend className="mb-1 text-sm font-semibold">Wajib dibaca oleh</legend>
                  <p className="text-xs text-muted-foreground">Tanpa pilihan role, semua coach aktif yang punya akun wajib membaca.</p>
                  <div className="flex flex-wrap gap-x-4 gap-y-2">
                    {(roles.data ?? []).map((r) => (
                      <label key={r.code} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-[var(--color-forest)]"
                          checked={audience.includes(r.code)}
                          onChange={(e) =>
                            setAudience((cur) => (e.target.checked ? [...cur, r.code] : cur.filter((c) => c !== r.code)))
                          }
                        />
                        {r.name}
                      </label>
                    ))}
                  </div>
                </fieldset>
                <Field label="Pengingat otomatis (hari)" hint="Yang belum membaca diingatkan setelah sekian hari, lalu setiap sekian hari. 0 = manual saja.">
                  <Input type="number" min={0} max={60} value={remindDays} onChange={(e) => setRemindDays(e.target.value)} />
                </Field>
              </>
            )}
          </DialogPanelBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Batal
            </Button>
            <Button type="submit" disabled={!valid || save.isPending}>
              Terbitkan
            </Button>
          </DialogFooter>
        </DialogPanelForm>
      </DialogPanel>
    </Dialog>
  );
}
