"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Dumbbell, ExternalLink, Plus, Repeat, Trash2, Waypoints } from "lucide-react";
import { toast } from "sonner";
import { Field, TableNote, TEXTAREA } from "@/features/crm/engagement/components/shared";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
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
import { StatCard } from "@/components/ui/stat-card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EXERCISE_CATEGORIES, RACE_COMPARABLE_SIMILARITY } from "@/lib/gym/hyrox";
import { trainingApi, type ExerciseRow, type SubstitutionRow } from "../api";
import { SELECT } from "./shared";

const LIBRARY_KEY = ["gym", "exercises"];

const CATEGORY_LABELS: Record<ExerciseRow["category"], string> = {
  ERG: "Erg",
  SLED: "Sled",
  JUMP: "Lompat",
  CARRY: "Angkut",
  LUNGE: "Lunge",
  THROW: "Lempar",
  RUN: "Lari",
  CONDITIONING: "Conditioning",
};

const DIFFICULTY = ["", "Ringan", "Sedang", "Berat"];

const spec = (e: Pick<ExerciseRow, "default_spec">) =>
  [e.default_spec.distanceM ? `${e.default_spec.distanceM} m` : null, e.default_spec.reps ? `${e.default_spec.reps} rep` : null]
    .filter(Boolean)
    .join(" · ") || "—";

/** Gym → Stasiun & Latihan: pustaka stasiun HYROX dan aturan substitusi alat. */
export function ExercisesPage() {
  const queryClient = useQueryClient();
  const library = useQuery({ queryKey: LIBRARY_KEY, queryFn: trainingApi.library });
  const [editing, setEditing] = useState<ExerciseRow | "new" | null>(null);
  const [subsFor, setSubsFor] = useState<ExerciseRow | null>(null);
  const [deleting, setDeleting] = useState<ExerciseRow | null>(null);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: LIBRARY_KEY });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => trainingApi.deleteExercise(id),
    onSuccess: () => {
      toast.success("Latihan dihapus");
      setDeleting(null);
      refresh();
    },
    onError: (error) => toast.error("Latihan gagal dihapus", { description: error.message }),
  });

  const exercises = library.data?.exercises ?? [];
  const substitutions = library.data?.substitutions ?? [];
  const stations = exercises.filter((e) => e.hyrox_station_order !== null && e.is_active).length;
  const subsOf = (id: string) => substitutions.filter((s) => s.original_exercise_id === id);

  return (
    <div className="space-y-4">
      <PageHeader
        kicker="Gym · Latihan"
        title="Stasiun & Latihan"
        description="Delapan stasiun HYROX, lari, dan latihan pengganti. Generator workout member memakai pustaka ini dan menukar stasiun saat alatnya tidak ada."
        actions={
          <Button onClick={() => setEditing("new")}>
            <Plus /> Latihan baru
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
        <StatCard
          label="Stasiun HYROX"
          value={stations}
          unit="/ 8"
          icon={<Waypoints />}
          tone={stations < 8 ? "warning" : "ink"}
          hint={stations < 8 ? "Simulasi penuh butuh 8 stasiun aktif" : undefined}
        />
        <StatCard label="Latihan aktif" value={exercises.filter((e) => e.is_active).length} icon={<Dumbbell />} />
        <StatCard label="Aturan substitusi" value={substitutions.length} icon={<Repeat />} />
      </div>

      <Card className="py-0">
        {library.isLoading ? (
          <TableNote>Memuat latihan…</TableNote>
        ) : library.error ? (
          <TableNote tone="danger">{library.error.message}</TableNote>
        ) : exercises.length === 0 ? (
          <TableNote>Belum ada latihan. Klik Latihan baru untuk menambah stasiun pertama.</TableNote>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">#</TableHead>
                <TableHead>Latihan</TableHead>
                <TableHead className="hidden md:table-cell">Alat</TableHead>
                <TableHead className="hidden lg:table-cell">Standar</TableHead>
                <TableHead className="hidden sm:table-cell">Pengganti</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {exercises.map((exercise) => {
                const subs = subsOf(exercise.id);
                return (
                  <TableRow key={exercise.id} className={exercise.is_active ? undefined : "opacity-60"}>
                    <TableCell>
                      {exercise.hyrox_station_order ? (
                        <Badge variant="ink">{exercise.hyrox_station_order}</Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="max-w-[18rem] whitespace-normal">
                      <p className="font-medium">
                        {exercise.name}
                        {!exercise.is_active && <span className="ml-2 text-xs text-muted-foreground">nonaktif</span>}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {CATEGORY_LABELS[exercise.category]} · {DIFFICULTY[exercise.difficulty]} ·{" "}
                        <span className="font-mono">{exercise.code}</span>
                      </p>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <div className="flex flex-wrap gap-1">
                        {exercise.equipment.length === 0 ? (
                          <span className="text-xs text-muted-foreground">Tanpa alat</span>
                        ) : (
                          exercise.equipment.map((item) => (
                            <Badge key={item} variant="muted">
                              {item}
                            </Badge>
                          ))
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="hidden tabular-nums lg:table-cell">{spec(exercise)}</TableCell>
                    <TableCell className="hidden max-w-[14rem] whitespace-normal text-xs sm:table-cell">
                      {subs.length === 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        subs.map((s) => s.alternative_name).join(", ")
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        {exercise.video_url && (
                          <a
                            href={exercise.video_url}
                            target="_blank"
                            rel="noreferrer"
                            className={buttonVariants({ variant: "ghost", size: "sm" })}
                            aria-label={`Video ${exercise.name}`}
                          >
                            <ExternalLink />
                          </a>
                        )}
                        <Button variant="ghost" size="sm" onClick={() => setSubsFor(exercise)}>
                          <Repeat /> Substitusi
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setEditing(exercise)}>
                          Ubah
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-danger"
                          aria-label={`Hapus ${exercise.name}`}
                          onClick={() => setDeleting(exercise)}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>

      {editing && (
        <ExerciseDialog exercise={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={refresh} />
      )}
      {subsFor && (
        <SubstitutionsDialog
          exercise={subsFor}
          exercises={exercises}
          rules={subsOf(subsFor.id)}
          onClose={() => setSubsFor(null)}
          onChanged={refresh}
        />
      )}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Hapus ${deleting?.name ?? "latihan"}?`}
        description="Aturan substitusinya ikut terhapus. Workout member yang sudah dibuat tetap utuh. Untuk menyembunyikan sementara, nonaktifkan lewat Ubah."
        confirmLabel="Hapus latihan"
        variant="danger"
        loading={deleteMutation.isPending}
        onConfirm={() => deleting && deleteMutation.mutate(deleting.id)}
      />
    </div>
  );
}

function ExerciseDialog({
  exercise,
  onClose,
  onSaved,
}: {
  exercise: ExerciseRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    code: exercise?.code ?? "",
    name: exercise?.name ?? "",
    description: exercise?.description ?? "",
    category: exercise?.category ?? "CONDITIONING",
    station: exercise?.hyrox_station_order ? String(exercise.hyrox_station_order) : "",
    difficulty: String(exercise?.difficulty ?? 2),
    distance: exercise?.default_spec.distanceM ? String(exercise.default_spec.distanceM) : "",
    reps: exercise?.default_spec.reps ? String(exercise.default_spec.reps) : "",
    equipment: exercise?.equipment.join(", ") ?? "",
    video_url: exercise?.video_url ?? "",
    is_active: exercise?.is_active ?? true,
  });
  const set =
    (key: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm((cur) => ({ ...cur, [key]: e.target.value }));

  const save = useMutation({
    mutationFn: () =>
      trainingApi.saveExercise({
        id: exercise?.id,
        code: form.code.trim(),
        name: form.name.trim(),
        description: form.description,
        category: form.category as ExerciseRow["category"],
        equipment: form.equipment
          .split(",")
          .map((item) => item.trim().toLowerCase().replace(/\s+/g, "_"))
          .filter(Boolean),
        hyrox_station_order: form.station ? Number(form.station) : null,
        difficulty: Number(form.difficulty) as ExerciseRow["difficulty"],
        default_spec: { distanceM: Number(form.distance) || null, reps: Number(form.reps) || null },
        video_url: form.video_url.trim() || null,
        is_active: form.is_active,
      }),
    onSuccess: () => {
      toast.success("Latihan disimpan", { description: form.name });
      onSaved();
      onClose();
    },
    onError: (error) => toast.error("Latihan gagal disimpan", { description: error.message }),
  });

  const valid = /^[a-z0-9_]{2,40}$/.test(form.code.trim()) && form.name.trim().length >= 2;

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
            <DialogPanelTitle>{exercise ? `Ubah ${exercise.name}` : "Latihan baru"}</DialogPanelTitle>
            <DialogPanelDescription>
              Nomor stasiun 1–8 menandai stasiun race. Alat yang diisi di sini menentukan kapan generator mencari pengganti.
            </DialogPanelDescription>
          </DialogPanelHeader>
          <DialogPanelBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Nama">
              <Input value={form.name} onChange={set("name")} placeholder="Sled Push" required />
            </Field>
            <Field label="Kode" hint="Huruf kecil, angka, garis bawah.">
              <Input value={form.code} onChange={set("code")} placeholder="sled_push" className="font-mono" required />
            </Field>
            <Field label="Kategori">
              <select className={SELECT} value={form.category} onChange={set("category")}>
                {EXERCISE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABELS[c]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Stasiun HYROX">
              <select className={SELECT} value={form.station} onChange={set("station")}>
                <option value="">Bukan stasiun race</option>
                {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                  <option key={n} value={n}>
                    Stasiun {n}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Jarak standar (m)">
              <Input type="number" min={0} value={form.distance} onChange={set("distance")} placeholder="50" />
            </Field>
            <Field label="Repetisi standar">
              <Input type="number" min={0} value={form.reps} onChange={set("reps")} placeholder="100" />
            </Field>
            <Field label="Tingkat">
              <select className={SELECT} value={form.difficulty} onChange={set("difficulty")}>
                <option value="1">Ringan</option>
                <option value="2">Sedang</option>
                <option value="3">Berat</option>
              </select>
            </Field>
            <Field label="Alat" hint="Pisahkan dengan koma, mis. sled, kettlebell. Kosong = tanpa alat.">
              <Input value={form.equipment} onChange={set("equipment")} placeholder="sled" />
            </Field>
            <Field label="Video cara melakukan" className="sm:col-span-2">
              <Input type="url" value={form.video_url} onChange={set("video_url")} placeholder="https://youtube.com/…" />
            </Field>
            <Field label="Deskripsi" className="sm:col-span-2">
              <textarea className={TEXTAREA} value={form.description} onChange={set("description")} />
            </Field>
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input
                type="checkbox"
                className="size-4 accent-forest"
                checked={form.is_active}
                onChange={(e) => setForm((cur) => ({ ...cur, is_active: e.target.checked }))}
              />
              Aktif (dipakai generator workout member)
            </label>
          </DialogPanelBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Batal
            </Button>
            <Button type="submit" disabled={!valid || save.isPending}>
              Simpan
            </Button>
          </DialogFooter>
        </DialogPanelForm>
      </DialogPanel>
    </Dialog>
  );
}

function SubstitutionsDialog({
  exercise,
  exercises,
  rules,
  onClose,
  onChanged,
}: {
  exercise: ExerciseRow;
  exercises: ExerciseRow[];
  rules: SubstitutionRow[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const candidates = exercises.filter((e) => e.id !== exercise.id);
  const [form, setForm] = useState({ alternative: "", similarity: "75", factor: "1", note: "" });

  const add = useMutation({
    mutationFn: () =>
      trainingApi.saveSubstitution({
        original_exercise_id: exercise.id,
        alternative_exercise_id: form.alternative,
        similarity: Number(form.similarity) / 100,
        volume_factor: Number(form.factor) || 1,
        conversion_note: form.note.trim(),
      }),
    onSuccess: () => {
      toast.success("Substitusi disimpan");
      setForm({ alternative: "", similarity: "75", factor: "1", note: "" });
      onChanged();
    },
    onError: (error) => toast.error("Substitusi gagal disimpan", { description: error.message }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => trainingApi.deleteSubstitution(id),
    onSuccess: onChanged,
    onError: (error) => toast.error("Substitusi gagal dihapus", { description: error.message }),
  });

  const similarity = Number(form.similarity);
  const valid = form.alternative !== "" && similarity >= 0 && similarity <= 100 && Number(form.factor) > 0;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPanel size="lg">
        <DialogPanelHeader>
          <DialogPanelTitle>Pengganti {exercise.name}</DialogPanelTitle>
          <DialogPanelDescription>
            Generator memilih pengganti dengan kemiripan tertinggi yang alatnya tersedia. Di bawah{" "}
            {Math.round(RACE_COMPARABLE_SIMILARITY * 100)}% member diberi tahu sesi tidak lagi setara race.
          </DialogPanelDescription>
        </DialogPanelHeader>
        <DialogPanelBody className="space-y-4">
          {rules.length === 0 ? (
            <p className="text-sm text-muted-foreground">Belum ada pengganti untuk latihan ini.</p>
          ) : (
            <ul className="divide-y divide-border rounded-2xl bg-surface-2">
              {rules.map((rule) => (
                <li key={rule.id} className="flex items-start gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">
                      {rule.alternative_name}{" "}
                      <Badge variant={rule.similarity >= RACE_COMPARABLE_SIMILARITY ? "success" : "warning"}>
                        {Math.round(rule.similarity * 100)}%
                      </Badge>{" "}
                      {rule.volume_factor !== 1 && <Badge variant="muted">× {rule.volume_factor}</Badge>}
                    </p>
                    {rule.conversion_note && <p className="text-xs text-muted-foreground">{rule.conversion_note}</p>}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-danger"
                    aria-label={`Hapus pengganti ${rule.alternative_name}`}
                    disabled={remove.isPending}
                    onClick={() => remove.mutate(rule.id)}
                  >
                    <Trash2 />
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <form
            className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]"
            onSubmit={(e) => {
              e.preventDefault();
              add.mutate();
            }}
          >
            <Field label="Latihan pengganti">
              <select
                className={SELECT}
                value={form.alternative}
                onChange={(e) => setForm((cur) => ({ ...cur, alternative: e.target.value }))}
              >
                <option value="">Pilih latihan…</option>
                {candidates.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Kemiripan (%)">
              <Input
                type="number"
                min={0}
                max={100}
                value={form.similarity}
                onChange={(e) => setForm((cur) => ({ ...cur, similarity: e.target.value }))}
              />
            </Field>
            <Field label="Pengali volume" hint="0,5 = separuh jarak">
              <Input
                type="number"
                min={0.1}
                step={0.01}
                value={form.factor}
                onChange={(e) => setForm((cur) => ({ ...cur, factor: e.target.value }))}
              />
            </Field>
            <Field label="Catatan konversi" className="sm:col-span-3">
              <Input
                value={form.note}
                onChange={(e) => setForm((cur) => ({ ...cur, note: e.target.value }))}
                placeholder="Separuh jarak: 1000 m row ≈ 500 m air bike."
              />
            </Field>
            <div className="sm:col-span-3">
              <Button type="submit" variant="ink" disabled={!valid || add.isPending}>
                <Plus /> Simpan pengganti
              </Button>
            </div>
          </form>
        </DialogPanelBody>
      </DialogPanel>
    </Dialog>
  );
}
