"use client";

import { useState } from "react";
import { BedDouble, Building2, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatRupiah } from "@/lib/format";
import type { RoomRow, RoomTypeRow } from "@/lib/resort/types";
import { cn } from "@/lib/utils";
import { resortApi, useResortMutation, useRoomTypes, useRooms } from "@/features/resort/queries";
import { ROOM_STATUS_CLASS, ROOM_STATUS_LABEL } from "@/features/resort/types";

/**
 * Resort → Kamar & Tipe (owner 2026-09-06): master tipe kamar (kapasitas,
 * tarif weekday/weekend, extra bed, fasilitas) dan unit kamar fisik beserta
 * status housekeeping.
 */
type TypeForm = {
  code: string; name: string; description: string; zone: string;
  capacity_adults: number; capacity_children: number; extra_bed_capacity: number;
  rate_weekday: string; rate_weekend: string; extra_bed_rate: string; amenities: string; sort_order: number;
};
const emptyType: TypeForm = {
  code: "", name: "", description: "", zone: "", capacity_adults: 2, capacity_children: 0,
  extra_bed_capacity: 0, rate_weekday: "", rate_weekend: "", extra_bed_rate: "", amenities: "", sort_order: 0,
};

export function ResortRoomsPage() {
  const typesQuery = useRoomTypes();
  const types = typesQuery.data?.types ?? (typesQuery.isError ? [] : null);
  const seasons = typesQuery.data?.seasons ?? [];
  const roomsQuery = useRooms();
  const rooms = roomsQuery.data ?? (roomsQuery.isError ? [] : null);
  const [typeDialog, setTypeDialog] = useState<{ mode: "create" } | { mode: "edit"; row: RoomTypeRow } | null>(null);
  const [roomDialog, setRoomDialog] = useState<{ mode: "create" } | { mode: "edit"; row: RoomRow } | null>(null);

  const deleteType = useResortMutation(resortApi.deleteRoomType, "Tipe kamar dihapus");
  const deleteRoom = useResortMutation(resortApi.deleteRoom, "Kamar dihapus");
  const removeType = (row: RoomTypeRow) => {
    if (confirm(`Hapus tipe kamar "${row.name}"?`)) deleteType.mutate(row.id);
  };
  const removeRoom = (row: RoomRow) => {
    if (confirm(`Hapus kamar "${row.name}"?`)) deleteRoom.mutate(row.id);
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold"><Building2 className="h-6 w-6 text-brand-text" />Kamar &amp; Tipe</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Master akomodasi: tipe kamar dengan tarif weekday/weekend, lalu unit kamar fisik yang dijual.
        </p>
      </div>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Tipe kamar</h2>
          <Button size="sm" onClick={() => setTypeDialog({ mode: "create" })}><Plus className="mr-1 h-4 w-4" />Tipe baru</Button>
        </div>
        {types === null ? (
          <Card><CardContent className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Memuat…</CardContent></Card>
        ) : types.length === 0 ? (
          <Card><CardContent className="p-6 text-center text-sm text-muted-foreground">Belum ada tipe kamar.</CardContent></Card>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {types.map((t) => (
              <Card key={t.id} className={cn(!t.is_active && "opacity-60")}>
                <CardContent className="space-y-2 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{t.name}</p>
                      <p className="text-xs text-muted-foreground">{t.code}{t.zone ? ` · ${t.zone}` : ""} · {t.room_count} unit</p>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <button type="button" onClick={() => setTypeDialog({ mode: "edit", row: t })} className="rounded-md p-1.5 hover:bg-muted" title="Ubah"><Pencil className="h-4 w-4" /></button>
                      <button type="button" onClick={() => removeType(t)} className="rounded-md p-1.5 text-destructive hover:bg-destructive/10" title="Hapus"><Trash2 className="h-4 w-4" /></button>
                    </div>
                  </div>
                  <div className="rounded-md bg-muted/50 p-2 text-xs">
                    <div className="flex justify-between"><span className="text-muted-foreground">Weekday</span><span className="font-semibold">{formatRupiah(t.rate_weekday)}</span></div>
                    <div className="mt-0.5 flex justify-between"><span className="text-muted-foreground">Weekend (Jum–Sab)</span><span className="font-semibold">{formatRupiah(t.rate_weekend)}</span></div>
                    {t.extra_bed_capacity > 0 && (
                      <div className="mt-0.5 flex justify-between"><span className="text-muted-foreground">Extra bed (maks {t.extra_bed_capacity})</span><span>{formatRupiah(t.extra_bed_rate)}</span></div>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Kapasitas {t.capacity_adults} dewasa{t.capacity_children ? ` + ${t.capacity_children} anak` : ""}
                    {t.amenities?.length ? ` · ${t.amenities.join(", ")}` : ""}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
        {seasons.length > 0 && (
          <p className="mt-2 text-xs text-muted-foreground">
            Musim tarif aktif: {seasons.map((s) => `${s.label} (${s.start_date} → ${s.end_date}${s.rate ? `, ${formatRupiah(s.rate)}` : s.surcharge_percent ? `, +${s.surcharge_percent}%` : ""})`).join(" · ")}
          </p>
        )}
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Unit kamar</h2>
          <Button size="sm" variant="outline" disabled={!types?.length} onClick={() => setRoomDialog({ mode: "create" })}>
            <Plus className="mr-1 h-4 w-4" />Kamar baru
          </Button>
        </div>
        {rooms === null ? (
          <Card><CardContent className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Memuat…</CardContent></Card>
        ) : rooms.length === 0 ? (
          <Card><CardContent className="p-6 text-center text-sm text-muted-foreground">Belum ada unit kamar.</CardContent></Card>
        ) : (
          <Card><CardContent className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Kamar</th>
                  <th className="px-3 py-2 text-left font-medium">Tipe</th>
                  <th className="px-3 py-2 text-left font-medium">Status</th>
                  <th className="px-3 py-2 text-left font-medium">Tamu saat ini</th>
                  <th className="w-20 px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {rooms.map((r) => (
                  <tr key={r.id} className={cn(!r.is_active && "opacity-60")}>
                    <td className="px-3 py-2">
                      <p className="font-medium">{r.name}</p>
                      <p className="text-xs text-muted-foreground">{r.code}{r.zone ? ` · ${r.zone}` : ""}</p>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{r.room_type_name}</td>
                    <td className="px-3 py-2">
                      <span className={cn("rounded-full border px-2 py-0.5 text-[11px] font-medium", ROOM_STATUS_CLASS[r.status])}>
                        {ROOM_STATUS_LABEL[r.status]}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{r.guest_name ?? "—"}</td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-1">
                        <button type="button" onClick={() => setRoomDialog({ mode: "edit", row: r })} className="rounded-md p-1.5 hover:bg-muted" title="Ubah"><Pencil className="h-4 w-4" /></button>
                        <button type="button" onClick={() => removeRoom(r)} className="rounded-md p-1.5 text-destructive hover:bg-destructive/10" title="Hapus"><Trash2 className="h-4 w-4" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent></Card>
        )}
      </section>

      {typeDialog && (
        <TypeDialog
          initial={typeDialog.mode === "edit" ? typeDialog.row : null}
          onClose={() => setTypeDialog(null)}
          onSaved={() => setTypeDialog(null)}
        />
      )}
      {roomDialog && types && (
        <RoomDialog
          types={types.filter((t) => t.is_active)}
          initial={roomDialog.mode === "edit" ? roomDialog.row : null}
          onClose={() => setRoomDialog(null)}
          onSaved={() => setRoomDialog(null)}
        />
      )}
    </div>
  );
}

function TypeDialog({ initial, onClose, onSaved }: { initial: RoomTypeRow | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<TypeForm>(() => initial ? {
    code: initial.code, name: initial.name, description: initial.description ?? "", zone: initial.zone ?? "",
    capacity_adults: initial.capacity_adults, capacity_children: initial.capacity_children,
    extra_bed_capacity: initial.extra_bed_capacity, rate_weekday: String(initial.rate_weekday || ""),
    rate_weekend: String(initial.rate_weekend || ""), extra_bed_rate: String(initial.extra_bed_rate || ""),
    amenities: (initial.amenities ?? []).join(", "), sort_order: initial.sort_order,
  } : emptyType);
  const mutation = useResortMutation(
    (body: Record<string, unknown>) => resortApi.saveRoomType(initial?.id ?? null, body),
    "Tersimpan",
    onSaved
  );
  const busy = mutation.isPending;

  const save = () => {
    if (!form.code.trim() || !form.name.trim()) { toast.error("Kode dan nama tipe wajib diisi"); return; }
    const payload = {
      name: form.name.trim(), description: form.description.trim() || null, zone: form.zone.trim() || null,
      capacity_adults: form.capacity_adults, capacity_children: form.capacity_children,
      extra_bed_capacity: form.extra_bed_capacity,
      rate_weekday: Number(form.rate_weekday) || 0, rate_weekend: Number(form.rate_weekend) || 0,
      extra_bed_rate: Number(form.extra_bed_rate) || 0,
      amenities: form.amenities.split(",").map((a) => a.trim()).filter(Boolean),
      sort_order: form.sort_order,
    };
    mutation.mutate(initial ? payload : { ...payload, code: form.code.trim() });
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><BedDouble className="h-5 w-5" />{initial ? `Ubah ${initial.name}` : "Tipe kamar baru"}</DialogTitle></DialogHeader>
        <div className="grid max-h-[70vh] gap-3 overflow-y-auto sm:grid-cols-2">
          <label className="text-xs text-muted-foreground">Kode
            <Input value={form.code} disabled={Boolean(initial)} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))} className="mt-1" placeholder="CABIN-FAM" />
          </label>
          <label className="text-xs text-muted-foreground">Nama
            <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className="mt-1" placeholder="Family Cabin" />
          </label>
          <label className="text-xs text-muted-foreground">Area / zona
            <Input value={form.zone} onChange={(e) => setForm((f) => ({ ...f, zone: e.target.value }))} className="mt-1" placeholder="Cabin Area" />
          </label>
          <label className="text-xs text-muted-foreground">Urutan tampil
            <Input type="number" min={0} value={form.sort_order} onChange={(e) => setForm((f) => ({ ...f, sort_order: Number(e.target.value) || 0 }))} className="mt-1" />
          </label>
          <label className="text-xs text-muted-foreground">Tarif weekday (Rp)
            <Input inputMode="numeric" value={form.rate_weekday} onChange={(e) => setForm((f) => ({ ...f, rate_weekday: e.target.value.replace(/[^\d]/g, "") }))} className="mt-1" />
          </label>
          <label className="text-xs text-muted-foreground">Tarif weekend Jum–Sab (Rp)
            <Input inputMode="numeric" value={form.rate_weekend} onChange={(e) => setForm((f) => ({ ...f, rate_weekend: e.target.value.replace(/[^\d]/g, "") }))} className="mt-1" />
          </label>
          <label className="text-xs text-muted-foreground">Kapasitas dewasa
            <Input type="number" min={1} value={form.capacity_adults} onChange={(e) => setForm((f) => ({ ...f, capacity_adults: Math.max(1, Number(e.target.value) || 1) }))} className="mt-1" />
          </label>
          <label className="text-xs text-muted-foreground">Kapasitas anak
            <Input type="number" min={0} value={form.capacity_children} onChange={(e) => setForm((f) => ({ ...f, capacity_children: Math.max(0, Number(e.target.value) || 0) }))} className="mt-1" />
          </label>
          <label className="text-xs text-muted-foreground">Maks extra bed
            <Input type="number" min={0} value={form.extra_bed_capacity} onChange={(e) => setForm((f) => ({ ...f, extra_bed_capacity: Math.max(0, Number(e.target.value) || 0) }))} className="mt-1" />
          </label>
          <label className="text-xs text-muted-foreground">Tarif extra bed / malam (Rp)
            <Input inputMode="numeric" value={form.extra_bed_rate} onChange={(e) => setForm((f) => ({ ...f, extra_bed_rate: e.target.value.replace(/[^\d]/g, "") }))} className="mt-1" />
          </label>
          <label className="text-xs text-muted-foreground sm:col-span-2">Fasilitas (pisahkan dengan koma)
            <Input value={form.amenities} onChange={(e) => setForm((f) => ({ ...f, amenities: e.target.value }))} className="mt-1" placeholder="2 kamar tidur, bonfire, hot tub" />
          </label>
          <label className="text-xs text-muted-foreground sm:col-span-2">Deskripsi
            <Textarea rows={2} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} className="mt-1" />
          </label>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>Batal</Button>
          <Button onClick={save} disabled={busy}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Simpan</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RoomDialog({ types, initial, onClose, onSaved }: {
  types: RoomTypeRow[]; initial: RoomRow | null; onClose: () => void; onSaved: () => void;
}) {
  const [form, setForm] = useState({
    room_type_id: initial?.room_type_id ?? types[0]?.id ?? "",
    code: initial?.code ?? "", name: initial?.name ?? "", zone: initial?.zone ?? "",
    status: initial?.status ?? ("siap" as RoomRow["status"]), notes: initial?.notes ?? "",
  });
  const mutation = useResortMutation(
    (body: Record<string, unknown>) => resortApi.saveRoom(initial?.id ?? null, body),
    "Tersimpan",
    onSaved
  );
  const busy = mutation.isPending;

  const save = () => {
    if (!form.room_type_id || !form.code.trim() || !form.name.trim()) { toast.error("Tipe, kode, dan nama kamar wajib diisi"); return; }
    mutation.mutate(initial
      ? {
          name: form.name.trim(), zone: form.zone.trim() || null, status: form.status,
          notes: form.notes.trim() || null, room_type_id: form.room_type_id,
        }
      : {
          room_type_id: form.room_type_id, code: form.code.trim(), name: form.name.trim(),
          zone: form.zone.trim() || null, notes: form.notes.trim() || null,
        });
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>{initial ? `Ubah ${initial.name}` : "Unit kamar baru"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <label className="block text-xs text-muted-foreground">Tipe kamar
            <select value={form.room_type_id} onChange={(e) => setForm((f) => ({ ...f, room_type_id: e.target.value }))}
              className="mt-1 block h-10 w-full rounded-md border bg-background px-2 text-sm">
              {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs text-muted-foreground">Kode
              <Input value={form.code} disabled={Boolean(initial)} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))} className="mt-1" placeholder="CB-01" />
            </label>
            <label className="text-xs text-muted-foreground">Nama
              <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className="mt-1" placeholder="Cabin 1" />
            </label>
            <label className="text-xs text-muted-foreground">Area
              <Input value={form.zone} onChange={(e) => setForm((f) => ({ ...f, zone: e.target.value }))} className="mt-1" placeholder="Cabin Area" />
            </label>
            {initial && (
              <label className="text-xs text-muted-foreground">Status
                <select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as RoomRow["status"] }))}
                  className="mt-1 block h-10 w-full rounded-md border bg-background px-2 text-sm">
                  {(["siap", "kotor", "perbaikan", "ditutup"] as const).map((s) => <option key={s} value={s}>{ROOM_STATUS_LABEL[s]}</option>)}
                </select>
              </label>
            )}
          </div>
          <label className="block text-xs text-muted-foreground">Catatan
            <Textarea rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} className="mt-1" />
          </label>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>Batal</Button>
          <Button onClick={save} disabled={busy}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Simpan</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
