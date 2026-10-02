"use client";

import { useMember } from "../member-app";
import { friendlyDay, type MyPass } from "../lib";
import { CenterSpinner, Empty, SectionTitle, Tag } from "../ui";
import { BuyPackages } from "./buy-packages";

const STATUS: Record<MyPass["status"], { label: string; tone: "lime" | "muted" | "warn" | "danger" }> = {
  active: { label: "Aktif", tone: "lime" },
  scheduled: { label: "Mulai nanti", tone: "warn" },
  expired: { label: "Kedaluwarsa", tone: "muted" },
  exhausted: { label: "Habis", tone: "muted" },
  cancelled: { label: "Dibatalkan", tone: "danger" },
  pending_payment: { label: "Menunggu bayar", tone: "warn" },
};

export function PassesTab() {
  const { passes } = useMember();
  if (!passes) return <CenterSpinner />;
  const current = passes
    .filter((p) => p.status === "active" || p.status === "scheduled")
    .sort((a, b) => a.valid_until.localeCompare(b.valid_until));
  const past = passes.filter((p) => p.status !== "active" && p.status !== "scheduled");

  return (
    <div className="space-y-7 pt-2">
      <div>
        <h1 className="font-display text-3xl font-bold uppercase tracking-tight">Paket saya</h1>
        <p className="mt-1 text-sm text-nh-beige/60">Kredit dipakai otomatis dari paket yang paling dulu berakhir.</p>
      </div>

      {current.length === 0 ? (
        <Empty title="Belum ada paket aktif." hint="Pilih paket di bawah untuk mulai latihan." />
      ) : (
        <div className="space-y-3">
          {current.map((p) => (
            <PassCard key={p.id} pass={p} />
          ))}
        </div>
      )}

      <BuyPackages />

      {past.length > 0 && (
        <section>
          <SectionTitle>Riwayat paket</SectionTitle>
          <div className="space-y-2">
            {past.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{p.product_name}</p>
                  <p className="text-xs text-nh-beige/50">
                    {p.pass_code} · s/d {friendlyDay(p.valid_until)}
                  </p>
                </div>
                <Tag tone={STATUS[p.status].tone}>{STATUS[p.status].label}</Tag>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function PassCard({ pass: p }: { pass: MyPass }) {
  const s = STATUS[p.status];
  return (
    <div className="relative overflow-hidden rounded-[2rem] border border-nh-lime/20 bg-gradient-to-br from-nh-forest to-nh-everglade p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-display text-xl font-semibold">{p.product_name}</p>
          <p className="text-xs text-nh-beige/60">{p.pass_code}</p>
        </div>
        <Tag tone={s.tone}>{s.label}</Tag>
      </div>
      <div className="mt-5 space-y-4">
        {p.class_credits_total > 0 && <Meter label="Kelas" left={p.class_left} total={p.class_credits_total} />}
        {p.pt_credits_total > 0 && <Meter label="Personal Training" left={p.pt_left} total={p.pt_credits_total} />}
        {p.facility_access && <p className="text-sm text-nh-lemon">Termasuk akses fasilitas</p>}
      </div>
      <p className="mt-5 text-xs text-nh-beige/60">
        {p.status === "scheduled" ? `Mulai ${friendlyDay(p.valid_from)} · ` : ""}Berlaku sampai {friendlyDay(p.valid_until)}
      </p>
    </div>
  );
}

function Meter({ label, left, total }: { label: string; left: number; total: number }) {
  return (
    <div>
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-nh-beige/70">{label}</span>
        <span className="font-display font-semibold tabular-nums">
          <span className="text-2xl text-nh-lime">{left}</span>
          <span className="text-nh-beige/50"> / {total}</span>
        </span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
        <div className="h-full rounded-full bg-nh-lime" style={{ width: `${Math.min(100, (left / Math.max(total, 1)) * 100)}%` }} />
      </div>
    </div>
  );
}
