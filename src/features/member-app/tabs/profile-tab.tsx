"use client";

import { useEffect, useState } from "react";
import { LogOut } from "lucide-react";
import { useMember } from "../member-app";
import { type CoachProfile, memberFetch } from "../lib";
import { Avatar, Card, CenterSpinner, PillButton, SectionTitle, Sheet, Tag } from "../ui";

export function ProfileTab() {
  const { profile, bookings, logout, go } = useMember();
  const [coaches, setCoaches] = useState<CoachProfile[] | null>(null);
  const [open, setOpen] = useState<CoachProfile | null>(null);

  useEffect(() => {
    memberFetch<{ data: CoachProfile[] }>("/api/member-portal/studio/coaches")
      .then((r) => setCoaches(r.data))
      .catch(() => setCoaches([]));
  }, []);

  const attended = (bookings ?? []).filter((b) => b.status === "attended").length;

  return (
    <div className="space-y-7 pt-2">
      <section className="flex items-center gap-4">
        <Avatar name={profile.name ?? "Member"} size={64} />
        <div className="min-w-0">
          <p className="truncate font-display text-2xl font-semibold">{profile.name ?? "Member"}</p>
          <p className="text-sm text-nh-beige/60">{profile.phone}</p>
        </div>
      </section>

      <Card>
        <p className="text-xs text-nh-beige/60">Sesi hadir (30 hari terakhir)</p>
        <p className="mt-1 font-display text-3xl font-bold tabular-nums text-nh-lime">{attended}</p>
        <p className="mt-1 text-xs text-nh-beige/50">Konsisten itu progres. Sampai jumpa di sesi berikutnya.</p>
      </Card>

      <section>
        <SectionTitle>Coach kami</SectionTitle>
        {!coaches ? (
          <CenterSpinner />
        ) : coaches.length === 0 ? (
          <p className="text-sm text-nh-beige/50">Profil coach segera hadir.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {coaches.map((c) => (
              <Card key={c.id} onClick={() => setOpen(c)} className="text-center">
                <span className="mx-auto block w-fit">
                  <Avatar name={c.name} photo={c.photo_url} size={80} />
                </span>
                <p className="mt-3 truncate font-semibold">{c.name}</p>
                <p className="text-xs text-nh-beige/55">{c.level === "head_coach" ? "Head Coach" : "Coach"}</p>
              </Card>
            ))}
          </div>
        )}
      </section>

      <PillButton variant="ghost" className="w-full" onClick={logout}>
        <LogOut className="size-4" /> Keluar
      </PillButton>

      <Sheet open={!!open} onClose={() => setOpen(null)} title={open?.name ?? ""}>
        {open && (
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <Avatar name={open.name} photo={open.photo_url} size={88} />
              <div className="space-y-1">
                <Tag tone={open.level === "head_coach" ? "lime" : "muted"}>{open.level === "head_coach" ? "Head Coach" : "Coach"}</Tag>
                {open.offers_pt && <p className="text-xs text-nh-beige/60">Menerima Personal Training</p>}
              </div>
            </div>
            {open.bio && <p className="whitespace-pre-line text-sm leading-relaxed text-nh-beige/85">{open.bio}</p>}
            {open.specialties && open.specialties.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-nh-beige/50">Spesialisasi</p>
                <div className="flex flex-wrap gap-1.5">
                  {open.specialties.map((s) => (
                    <Tag key={s}>{s}</Tag>
                  ))}
                </div>
              </div>
            )}
            {open.certifications && (
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-nh-beige/50">Sertifikasi</p>
                <p className="whitespace-pre-line text-sm text-nh-beige/80">{open.certifications}</p>
              </div>
            )}
            {open.offers_pt && (
              <PillButton className="w-full" onClick={() => { setOpen(null); go("pt"); }}>
                Booking Personal Training
              </PillButton>
            )}
          </div>
        )}
      </Sheet>
    </div>
  );
}
