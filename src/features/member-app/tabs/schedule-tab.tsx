"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Users } from "lucide-react";
import { useMember } from "../member-app";
import { addDaysIso, type ClassSlot, dateLabel, dayShort, friendlyDay, jam, memberFetch, type ScheduleRules, wibToday } from "../lib";
import { Avatar, CenterSpinner, Empty, Notice, PillButton, Sheet, Tag } from "../ui";
import { cancelNote, hoursUntil } from "./booking-row";

export function ScheduleTab() {
  const { refresh, passes, go } = useMember();
  const [slots, setSlots] = useState<ClassSlot[] | null>(null);
  const [rules, setRules] = useState<ScheduleRules>({ cancel_window_hours: 12, booking_open_days: 7 });
  const [day, setDay] = useState(wibToday());
  const [selected, setSelected] = useState<ClassSlot | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await memberFetch<{ data: ClassSlot[]; rules: ScheduleRules }>("/api/member-portal/studio/schedule");
      setSlots(res.data);
      setRules(res.rules);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal memuat jadwal");
      setSlots([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const days = useMemo(() => {
    const today = wibToday();
    return Array.from({ length: rules.booking_open_days + 1 }, (_, i) => addDaysIso(today, i));
  }, [rules.booking_open_days]);

  const countByDay = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of slots ?? []) m.set(s.session_date, (m.get(s.session_date) ?? 0) + 1);
    return m;
  }, [slots]);

  const list = (slots ?? []).filter((s) => s.session_date === day);
  const classCredits = (passes ?? []).filter((p) => p.status === "active" || p.status === "scheduled").reduce((s, p) => s + p.class_left, 0);

  return (
    <div className="space-y-5 pt-2">
      <div>
        <h1 className="font-display text-3xl font-bold uppercase tracking-tight">Jadwal kelas</h1>
        <p className="mt-1 text-sm text-nh-beige/60">
          Sisa {classCredits} kelas · batal gratis sampai {rules.cancel_window_hours} jam sebelum sesi.
        </p>
      </div>

      <div className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1">
        {days.map((d) => {
          const active = d === day;
          const n = countByDay.get(d) ?? 0;
          return (
            <button
              key={d}
              type="button"
              onClick={() => setDay(d)}
              className={`flex w-14 shrink-0 flex-col items-center rounded-2xl py-2.5 transition ${active ? "bg-nh-lime text-nh-forest" : "bg-nh-jungle text-nh-beige"}`}
            >
              <span className={`text-[11px] font-semibold ${active ? "" : "text-nh-beige/60"}`}>{dayShort(d)}</span>
              <span className="font-display text-lg font-bold">{dateLabel(d).split(" ")[0]}</span>
              <span className={`mt-0.5 size-1.5 rounded-full ${n > 0 ? (active ? "bg-nh-forest" : "bg-nh-lime") : "bg-transparent"}`} />
            </button>
          );
        })}
      </div>

      {error && <Notice tone="error">{error}</Notice>}
      {!slots ? (
        <CenterSpinner />
      ) : list.length === 0 ? (
        <Empty title="Belum ada kelas di hari ini." hint="Coba pilih hari lain." />
      ) : (
        <div className="space-y-2">
          {list.map((s) => (
            <SlotRow key={s.id} slot={s} onOpen={() => setSelected(s)} />
          ))}
        </div>
      )}

      {selected && (
        <SlotSheet
          slot={selected}
          rules={rules}
          hasCredit={classCredits > 0}
          onClose={() => setSelected(null)}
          onBuy={() => { setSelected(null); go("passes"); }}
          onChanged={async () => {
            await Promise.all([load(), refresh()]);
          }}
        />
      )}
    </div>
  );
}

/** "Sampai jumpa besok, 06.30" / "Sabtu, 4 Okt". */
function seeYou(date: string): string {
  const d = friendlyDay(date);
  return d === "Hari ini" ? "nanti" : d === "Besok" ? "besok" : d;
}

function SlotRow({ slot: s, onOpen }: { slot: ClassSlot; onOpen: () => void }) {
  const full = s.spots_left <= 0;
  return (
    <button type="button" onClick={onOpen} className={`flex w-full items-center gap-4 rounded-2xl border px-4 py-3.5 text-left transition ${s.my_status ? "border-nh-lime/50 bg-nh-lime/5" : "border-white/10 bg-nh-jungle hover:border-white/20"}`}>
      <div className="w-14 shrink-0">
        <p className="font-display text-lg font-semibold tabular-nums">{jam(s.start_time)}</p>
        <p className="text-[11px] text-nh-beige/50">{jam(s.end_time)}</p>
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold">{s.program_name}</p>
        <p className="truncate text-xs text-nh-beige/60">{s.coach_name ?? "Coach akan diumumkan"}</p>
      </div>
      <div className="shrink-0 text-right">
        {s.my_status === "booked" ? (
          <Tag tone="lime">Terkunci</Tag>
        ) : s.my_status === "waitlisted" ? (
          <Tag tone="warn">Waitlist</Tag>
        ) : full ? (
          <Tag tone="danger">Penuh</Tag>
        ) : (
          <span className={`flex items-center gap-1 text-xs ${s.spots_left <= 2 ? "text-nh-lime" : "text-nh-beige/60"}`}>
            <Users className="size-3.5" /> {s.spots_left} tempat
          </span>
        )}
      </div>
    </button>
  );
}

function SlotSheet({
  slot: s,
  rules,
  hasCredit,
  onClose,
  onBuy,
  onChanged,
}: {
  slot: ClassSlot;
  rules: ScheduleRules;
  hasCredit: boolean;
  onClose: () => void;
  onBuy: () => void;
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const full = s.spots_left <= 0;

  async function act(kind: "book" | "cancel") {
    setBusy(true);
    setMsg(null);
    try {
      const res =
        kind === "book"
          ? await memberFetch<{ message: string }>("/api/member-portal/studio/bookings", { method: "POST", body: { session_id: s.id } })
          : await memberFetch<{ message: string }>(`/api/member-portal/studio/bookings/${s.my_booking_id}/cancel`, { method: "POST", body: {} });
      setMsg({ tone: "ok", text: kind === "book" && !full ? `Sesi kamu sudah terkunci. Sampai jumpa ${seeYou(s.session_date)}, ${jam(s.start_time)}.` : res.message });
      await onChanged();
    } catch (e) {
      setMsg({ tone: "error", text: e instanceof Error ? e.message : "Gagal" });
    } finally {
      setBusy(false);
    }
  }

  const late = hoursUntil(s.session_date, s.start_time) < rules.cancel_window_hours;

  return (
    <Sheet open onClose={onClose} title={s.program_name}>
      <p className="text-sm text-nh-beige/70">
        {friendlyDay(s.session_date)} · {jam(s.start_time)}–{jam(s.end_time)}
        {s.level_label ? ` · ${s.level_label}` : ""}
      </p>
      {s.program_description && <p className="mt-3 text-sm leading-relaxed text-nh-beige/80">{s.program_description}</p>}
      {s.coach_name && (
        <div className="mt-4 flex items-center gap-3 rounded-2xl bg-white/5 p-3">
          <Avatar name={s.coach_name} photo={s.coach_photo} size={44} />
          <div>
            <p className="text-xs text-nh-beige/60">Coach</p>
            <p className="font-semibold">{s.coach_name}</p>
          </div>
        </div>
      )}
      <p className="mt-4 text-sm text-nh-beige/70">
        {full ? `Kelas penuh · ${s.waitlist_count} orang di waitlist` : s.spots_left === 1 ? "Masih ada tempat untuk satu orang." : `${s.spots_left} dari ${s.capacity} tempat tersisa`}
      </p>

      <div className="mt-5 space-y-3">
        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
        {msg?.tone === "ok" ? (
          <PillButton variant="ghost" className="w-full" onClick={onClose}>Tutup</PillButton>
        ) : s.my_status ? (
          <>
            <div className={`rounded-2xl px-4 py-3 text-sm ${late && s.my_status === "booked" ? "bg-nh-ochre/20 text-nh-lemon" : "bg-white/5 text-nh-beige/80"}`}>
              {cancelNote(s.my_status, s.session_date, s.start_time, rules.cancel_window_hours)}
            </div>
            <PillButton variant="danger" className="w-full" disabled={busy} onClick={() => act("cancel")}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              {s.my_status === "waitlisted" ? "Keluar dari waitlist" : "Batalkan booking"}
            </PillButton>
          </>
        ) : !hasCredit ? (
          <>
            <div className="rounded-2xl bg-white/5 px-4 py-3 text-sm text-nh-beige/80">Kredit kelasmu habis. Pilih paket untuk lanjut latihan.</div>
            <PillButton className="w-full" onClick={onBuy}>Lihat paket</PillButton>
          </>
        ) : (
          <>
            <p className="text-xs text-nh-beige/50">1 kredit kelas dikunci saat booking. Batal ≥ {rules.cancel_window_hours} jam sebelum sesi, kredit kembali.</p>
            <PillButton className="w-full" disabled={busy} onClick={() => act("book")}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              {full ? "Masuk waitlist" : "Booking sesi ini"}
            </PillButton>
          </>
        )}
      </div>
    </Sheet>
  );
}
