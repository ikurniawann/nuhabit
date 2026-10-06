"use client";

import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import { useMember } from "../member-app";
import { type CoachProfile, memberFetch } from "../lib";
import { Avatar, CenterSpinner, Empty, Eyebrow, PageTitle, PillButton, Sheet, Tag } from "../ui";

/** Daftar coach — kartu foto hitam-putih penuh lebar (gaya "team" referensi). */
export function CoachesTab() {
  const [coaches, setCoaches] = useState<CoachProfile[] | null>(null);
  const [open, setOpen] = useState<CoachProfile | null>(null);

  useEffect(() => {
    memberFetch<{ data: CoachProfile[] }>("/api/member-portal/studio/coaches")
      .then((r) => setCoaches(r.data))
      .catch(() => setCoaches([]));
  }, []);

  return (
    <div className="space-y-8">
      <PageTitle sub="The people behind every session. Tap a coach to see their background.">
        The
        <br />
        coaches
      </PageTitle>
      {!coaches ? (
        <CenterSpinner />
      ) : coaches.length === 0 ? (
        <Empty title="Coach profiles coming soon." />
      ) : (
        <div className="grid grid-cols-2 gap-px border border-white/12 bg-white/12">
          {coaches.map((c) => (
            <CoachTile key={c.id} coach={c} onOpen={() => setOpen(c)} />
          ))}
        </div>
      )}
      <CoachSheet coach={open} onClose={() => setOpen(null)} />
    </div>
  );
}

export function CoachTile({ coach: c, onOpen }: { coach: CoachProfile; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="group relative block aspect-[3/4] w-full overflow-hidden bg-black text-left">
      {c.photo_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={c.photo_url} alt={c.name} className="absolute inset-0 size-full object-cover grayscale transition group-hover:scale-105" />
      ) : (
        <span className="absolute inset-0 flex items-center justify-center bg-nh-everglade font-display text-5xl font-bold text-nh-lime">
          {c.name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("")}
        </span>
      )}
      <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/70 to-transparent p-3 pt-10">
        <span className="block font-display text-lg font-bold uppercase leading-tight tracking-tight text-white">{c.name}</span>
        <span className="mt-0.5 block text-[10px] font-semibold uppercase tracking-[0.14em] text-nh-lime">{c.level === "head_coach" ? "Head Coach" : "Coach"}</span>
      </span>
    </button>
  );
}

export function CoachSheet({ coach, onClose }: { coach: CoachProfile | null; onClose: () => void }) {
  const { go } = useMember();
  return (
    <Sheet open={!!coach} onClose={onClose} title={coach?.name ?? ""}>
      {coach && (
        <div className="space-y-6">
          <div className="relative">
            <Avatar name={coach.name} photo={coach.photo_url} size={400} />
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Tag tone={coach.level === "head_coach" ? "lime" : "muted"}>{coach.level === "head_coach" ? "Head Coach" : "Coach"}</Tag>
            {coach.offers_pt && <Tag>Personal Training</Tag>}
          </div>
          {coach.bio && <p className="whitespace-pre-line text-sm leading-relaxed text-nh-beige/85">{coach.bio}</p>}
          {coach.specialties && coach.specialties.length > 0 && (
            <div>
              <Eyebrow className="mb-2">Specialties</Eyebrow>
              <div className="flex flex-wrap gap-1.5">
                {coach.specialties.map((s) => (
                  <Tag key={s}>{s}</Tag>
                ))}
              </div>
            </div>
          )}
          {coach.certifications && (
            <div>
              <Eyebrow className="mb-1">Certifications</Eyebrow>
              <p className="whitespace-pre-line text-sm text-nh-beige/80">{coach.certifications}</p>
            </div>
          )}
          {coach.offers_pt && (
            <PillButton className="w-full" onClick={() => { onClose(); go("pt"); }}>
              Book Personal Training <ArrowRight className="size-4" />
            </PillButton>
          )}
        </div>
      )}
    </Sheet>
  );
}
