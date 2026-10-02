"use client";

import { useMember } from "../member-app";
import { friendlyDay, type MyPass } from "../lib";
import { CenterSpinner, Empty, SectionTitle, Tag } from "../ui";
import { BuyPackages } from "./buy-packages";

const STATUS: Record<MyPass["status"], { label: string; tone: "lime" | "muted" | "warn" | "danger" }> = {
  active: { label: "Active", tone: "lime" },
  scheduled: { label: "Starts later", tone: "warn" },
  expired: { label: "Expired", tone: "muted" },
  exhausted: { label: "Used up", tone: "muted" },
  cancelled: { label: "Cancelled", tone: "danger" },
  pending_payment: { label: "Awaiting payment", tone: "warn" },
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
        <h1 className="font-display text-3xl font-bold uppercase tracking-tight">My passes</h1>
        <p className="mt-1 text-sm text-nh-beige/60">Credits are used from the pass that expires first.</p>
      </div>

      {current.length === 0 ? (
        <Empty title="No active pass yet." hint="Choose a pass below to start training." />
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
          <SectionTitle>Pass history</SectionTitle>
          <div className="space-y-2">
            {past.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{p.product_name}</p>
                  <p className="text-xs text-nh-beige/50">
                    {p.pass_code} · until {friendlyDay(p.valid_until)}
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
        {p.class_credits_total > 0 && <Meter label="Classes" left={p.class_left} total={p.class_credits_total} />}
        {p.pt_credits_total > 0 && <Meter label="Personal Training" left={p.pt_left} total={p.pt_credits_total} />}
        {p.facility_access && <p className="text-sm text-nh-lemon">Includes facility access</p>}
      </div>
      <p className="mt-5 text-xs text-nh-beige/60">
        {p.status === "scheduled" ? `Starts ${friendlyDay(p.valid_from)} · ` : ""}Valid until {friendlyDay(p.valid_until)}
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
