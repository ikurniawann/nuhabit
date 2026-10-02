"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Check, Loader2 } from "lucide-react";
import { useMember } from "../member-app";
import { addDaysIso, dateLabel, dayShort, friendlyDay, jam, memberFetch, type PtCatalogEntry, wibToday } from "../lib";
import { Avatar, Card, CenterSpinner, Empty, Notice, PillButton, SectionTitle, Sheet, Tag } from "../ui";
import { BookingRow } from "./booking-row";

type Coach = PtCatalogEntry["coaches"][number];

const coachName = (c: Coach) => c.display_name || c.full_name;

/** Booking Personal Training: program → coach → tanggal → jam → konfirmasi. */
export function PtTab() {
  const { passes, bookings, refresh, go } = useMember();
  const [catalog, setCatalog] = useState<PtCatalogEntry[] | null>(null);
  const [programId, setProgramId] = useState<string | null>(null);
  const [coach, setCoach] = useState<Coach | null>(null);
  const [date, setDate] = useState(wibToday());
  const [slots, setSlots] = useState<string[] | null>(null);
  const [time, setTime] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    memberFetch<{ data: PtCatalogEntry[] }>("/api/member-portal/studio/pt/catalog")
      .then((r) => {
        // Program tanpa coach tidak bisa dibooking — jangan tampilkan ke member.
        const bookable = r.data.filter((p) => p.coaches.length > 0);
        setCatalog(bookable);
        if (bookable.length === 1) setProgramId(bookable[0].id);
      })
      .catch(() => setCatalog([]));
  }, []);

  const program = catalog?.find((p) => p.id === programId) ?? null;
  const ptLeft = (passes ?? []).filter((p) => p.status === "active" || p.status === "scheduled").reduce((s, p) => s + p.pt_left, 0);
  const myPt = (bookings ?? []).filter((b) => b.program_kind === "pt" && b.upcoming && b.status === "booked");

  const loadSlots = useCallback(async () => {
    if (!program || !coach) return;
    setSlots(null);
    try {
      const r = await memberFetch<{ data: { coach: { id: string }; slots: string[] }[] }>(
        `/api/member-portal/studio/pt/slots?program_id=${program.id}&date=${date}&coach_id=${coach.id}`
      );
      setSlots(r.data[0]?.slots ?? []);
    } catch {
      setSlots([]);
    }
  }, [program, coach, date]);

  useEffect(() => {
    void loadSlots();
  }, [loadSlots]);

  const days = useMemo(() => Array.from({ length: 14 }, (_, i) => addDaysIso(wibToday(), i)), []);

  async function book() {
    if (!program || !coach || !time) return;
    setBusy(true);
    setMsg(null);
    try {
      await memberFetch("/api/member-portal/studio/pt/bookings", { method: "POST", body: { program_id: program.id, coach_id: coach.id, date, start_time: time } });
      setMsg({ tone: "ok", text: `Sesi Personal Training kamu sudah terkunci. Sampai jumpa ${friendlyDay(date)}, ${jam(time)} bersama ${coachName(coach)}.` });
      await Promise.all([refresh(), loadSlots()]);
    } catch (e) {
      setMsg({ tone: "error", text: e instanceof Error ? e.message : "Gagal booking" });
    } finally {
      setBusy(false);
    }
  }

  if (!catalog) return <CenterSpinner />;

  return (
    <div className="space-y-6 pt-2">
      <div>
        <h1 className="font-display text-3xl font-bold uppercase leading-tight tracking-tight">Personal Training</h1>
        <p className="mt-1 text-sm text-nh-beige/60">Sesi privat satu lawan satu bersama coach pilihanmu · sisa {ptLeft} sesi.</p>
      </div>

      {myPt.length > 0 && !coach && (
        <section>
          <SectionTitle>Jadwal Personal Training saya</SectionTitle>
          <div className="space-y-2">
            {myPt.map((b) => (
              <BookingRow key={b.id} booking={b} />
            ))}
          </div>
        </section>
      )}

      {catalog.length === 0 ? (
        <Empty title="Program Personal Training belum tersedia." hint="Tanyakan ke front desk untuk jadwal terdekat." />
      ) : ptLeft === 0 && !coach ? (
        <Card className="border-nh-lime/30">
          <p className="font-semibold">Belum ada kredit Personal Training.</p>
          <p className="mt-1 text-sm text-nh-beige/60">Pilih paket yang berisi Personal Training untuk mulai booking.</p>
          <PillButton className="mt-4" onClick={() => go("passes")}>Lihat paket</PillButton>
        </Card>
      ) : null}

      {catalog.length > 0 && !program && (
        <section>
          <SectionTitle>1. Pilih program</SectionTitle>
          <div className="space-y-2">
            {catalog.map((p) => (
              <Card key={p.id} onClick={() => setProgramId(p.id)}>
                <p className="font-semibold">{p.name}</p>
                <p className="mt-0.5 text-xs text-nh-beige/60">
                  {p.duration_minutes} menit{p.level_label ? ` · ${p.level_label}` : ""} · {p.coaches.length} coach
                </p>
                {p.description && <p className="mt-2 text-sm text-nh-beige/70">{p.description}</p>}
              </Card>
            ))}
          </div>
        </section>
      )}

      {program && !coach && (
        <section>
          {catalog.length > 1 && (
            <button type="button" onClick={() => setProgramId(null)} className="mb-3 flex items-center gap-1.5 text-sm text-nh-beige/70">
              <ArrowLeft className="size-4" /> {program.name}
            </button>
          )}
          <SectionTitle>{catalog.length > 1 ? "2. Pilih coach" : "Pilih coach"}</SectionTitle>
          {program.coaches.length === 0 ? (
            <Empty title="Belum ada coach untuk program ini." />
          ) : (
            <div className="space-y-2">
              {program.coaches.map((c) => (
                <Card key={c.id} onClick={() => { setCoach(c); setTime(null); setMsg(null); }}>
                  <div className="flex gap-3">
                    <Avatar name={coachName(c)} photo={c.photo_url} size={56} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="font-semibold">{coachName(c)}</p>
                        {c.level === "head_coach" && <Tag tone="lime">Head Coach</Tag>}
                      </div>
                      {c.bio && <p className="mt-1 line-clamp-2 text-sm text-nh-beige/70">{c.bio}</p>}
                      {c.specialties && c.specialties.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {c.specialties.slice(0, 4).map((s) => (
                            <Tag key={s}>{s}</Tag>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </section>
      )}

      {program && coach && (
        <section className="space-y-5">
          <button type="button" onClick={() => setCoach(null)} className="flex items-center gap-1.5 text-sm text-nh-beige/70">
            <ArrowLeft className="size-4" /> Ganti coach
          </button>
          <div className="flex items-center gap-3">
            <Avatar name={coachName(coach)} photo={coach.photo_url} size={48} />
            <div>
              <p className="font-display text-lg font-semibold">{coachName(coach)}</p>
              <p className="text-xs text-nh-beige/60">
                {program.name} · {program.duration_minutes} menit
              </p>
            </div>
          </div>

          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-nh-beige/60">Tanggal</p>
            <div className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1">
              {days.map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => { setDate(d); setTime(null); setMsg(null); }}
                  className={`flex w-14 shrink-0 flex-col items-center rounded-2xl py-2.5 ${d === date ? "bg-nh-lime text-nh-forest" : "bg-nh-jungle"}`}
                >
                  <span className={`text-[11px] font-semibold ${d === date ? "" : "text-nh-beige/60"}`}>{dayShort(d)}</span>
                  <span className="font-display text-lg font-bold">{dateLabel(d).split(" ")[0]}</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-nh-beige/60">Jam tersedia · {friendlyDay(date)}</p>
            {!slots ? (
              <CenterSpinner />
            ) : slots.length === 0 ? (
              <Empty title="Tidak ada jam kosong." hint="Coba tanggal lain atau coach lain." />
            ) : (
              <div className="grid grid-cols-4 gap-2">
                {slots.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => { setTime(t); setMsg(null); }}
                    className={`rounded-xl py-2.5 font-display text-sm font-semibold tabular-nums ${t === time ? "bg-nh-lime text-nh-forest" : "border border-white/10 bg-nh-jungle"}`}
                  >
                    {jam(t)}
                  </button>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      <Sheet open={!!(coach && time && program)} onClose={() => { setTime(null); setMsg(null); }} title="Konfirmasi Personal Training">
        {program && coach && time && (
          <div className="space-y-4">
            <div className="rounded-2xl bg-white/5 p-4">
              <p className="font-display text-3xl font-bold text-nh-lime tabular-nums">{jam(time)}</p>
              <p className="mt-1 font-semibold">{friendlyDay(date)}</p>
              <p className="text-sm text-nh-beige/70">
                {program.name} bersama {coachName(coach)}
              </p>
            </div>
            {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
            {msg?.tone === "ok" ? (
              <PillButton className="w-full" onClick={() => { setTime(null); setMsg(null); setCoach(null); }}>
                <Check className="size-4" /> Selesai
              </PillButton>
            ) : ptLeft === 0 ? (
              <>
                <div className="rounded-2xl bg-white/5 px-4 py-3 text-sm text-nh-beige/80">Kredit Personal Training kamu habis.</div>
                <PillButton className="w-full" onClick={() => go("passes")}>Lihat paket</PillButton>
              </>
            ) : (
              <>
                <p className="text-xs text-nh-beige/50">1 kredit Personal Training dikunci. Batal tepat waktu, kredit kembali.</p>
                <PillButton className="w-full" disabled={busy} onClick={book}>
                  {busy && <Loader2 className="size-4 animate-spin" />}
                  Kunci sesi ini
                </PillButton>
              </>
            )}
          </div>
        )}
      </Sheet>
    </div>
  );
}
