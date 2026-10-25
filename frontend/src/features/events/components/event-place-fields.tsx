"use client";

import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Field } from "@/features/crm/engagement/components/shared";
import { EVENTS_KEYS, eventsApi, type PlaceFields } from "../api";

/** Kelas <select> yang sama dengan form situs: pil penuh, border halus. */
export const SELECT_CLASS =
  "h-10 w-full rounded-full border border-border bg-card px-4 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-forest/40";

/** Pilihan cabang, coach, staf dan area untuk form event dan filter kalender. */
export function useCalendarOptions() {
  return useQuery({ queryKey: EVENTS_KEYS.options, queryFn: eventsApi.options, staleTime: 5 * 60_000 });
}

/**
 * Cabang, area, coach pengisi dan penanggung jawab: bagian form event yang
 * dipakai pemeriksaan bentrok dan notifikasi. Dipakai form CRM dan situs.
 */
export function EventPlaceFields({ value, onChange }: { value: PlaceFields; onChange: (next: PlaceFields) => void }) {
  const options = useCalendarOptions();
  const set = (key: keyof PlaceFields) => (v: string) => onChange({ ...value, [key]: v || null });
  return (
    <>
      <Field label="Cabang" hint="Dasar pemeriksaan bentrok ruangan dan kelas.">
        <select className={SELECT_CLASS} value={value.branch_id ?? ""} onChange={(e) => set("branch_id")(e.target.value)}>
          <option value="">Tanpa cabang</option>
          {(options.data?.branches ?? []).map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Area / ruangan" hint="Sama dengan nama area di jadwal kelas, mis. Arena.">
        <Input
          list="event-area-options"
          value={value.area ?? ""}
          onChange={(e) => set("area")(e.target.value)}
          placeholder="Arena"
          maxLength={80}
        />
        <datalist id="event-area-options">
          {(options.data?.areas ?? []).map((a) => (
            <option key={a} value={a} />
          ))}
        </datalist>
      </Field>
      <Field label="Coach pengisi" hint="Coach yang dipakai event tidak boleh mengajar kelas lain di jam itu.">
        <select className={SELECT_CLASS} value={value.coach_id ?? ""} onChange={(e) => set("coach_id")(e.target.value)}>
          <option value="">Tanpa coach</option>
          {(options.data?.coaches ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Penanggung jawab" hint="Mendapat notifikasi setiap perubahan dan pengingat event.">
        <select className={SELECT_CLASS} value={value.organiser_user_id ?? ""} onChange={(e) => set("organiser_user_id")(e.target.value)}>
          <option value="">Belum ditentukan</option>
          {(options.data?.staff ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </Field>
    </>
  );
}
