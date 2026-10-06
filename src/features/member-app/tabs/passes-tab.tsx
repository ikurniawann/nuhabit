"use client";

import { useMember } from "../member-app";
import { friendlyDay, type MyPass } from "../lib";
import { Accordion, CenterSpinner, Empty, Eyebrow, PageTitle, SideLabel, Tag } from "../ui";
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
    <div className="space-y-10">
      <PageTitle sub="Credits are used from the pass that expires first.">
        My
        <br />
        passes
      </PageTitle>

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
        <section className="border-t border-white/15">
          <Accordion title={`Pass history (${past.length})`}>
            <div className="border-t border-white/12">
              {past.map((p) => (
                <div key={p.id} className="flex items-center justify-between gap-3 border-b border-white/12 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold uppercase tracking-[0.03em] text-white">{p.product_name}</p>
                    <p className="text-[11px] uppercase tracking-wide text-nh-beige/50">
                      {p.pass_code} · until {friendlyDay(p.valid_until)}
                    </p>
                  </div>
                  <Tag tone={STATUS[p.status].tone}>{STATUS[p.status].label}</Tag>
                </div>
              ))}
            </div>
          </Accordion>
        </section>
      )}
    </div>
  );
}

function PassCard({ pass: p }: { pass: MyPass }) {
  const s = STATUS[p.status];
  return (
    <div className="flex border border-white/15">
      <SideLabel tone={p.status === "active" ? "lime" : "light"}>{s.label}</SideLabel>
      <div className="min-w-0 flex-1 p-5">
        <Eyebrow>{p.pass_code}</Eyebrow>
        <p className="mt-1 font-display text-2xl font-bold uppercase leading-[0.95] tracking-tight text-white">{p.product_name}</p>
        <div className="mt-5 space-y-4">
          {p.class_credits_total > 0 && <Meter label="Classes" left={p.class_left} total={p.class_credits_total} />}
          {p.pt_credits_total > 0 && <Meter label="Personal Training" left={p.pt_left} total={p.pt_credits_total} />}
          {p.facility_access && <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-nh-lemon">Includes facility access</p>}
        </div>
        <p className="mt-5 border-t border-white/12 pt-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-nh-beige/60">
          {p.status === "scheduled" ? `Starts ${friendlyDay(p.valid_from)} · ` : ""}Valid until {friendlyDay(p.valid_until)}
        </p>
      </div>
    </div>
  );
}

function Meter({ label, left, total }: { label: string; left: number; total: number }) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-nh-beige/70">{label}</span>
        <span className="font-display font-bold tabular-nums">
          <span className="text-3xl text-white">{left}</span>
          <span className="text-sm text-nh-beige/50"> / {total}</span>
        </span>
      </div>
      <div className="mt-2 h-1 bg-white/15">
        <div className="h-full bg-nh-lime" style={{ width: `${Math.min(100, (left / Math.max(total, 1)) * 100)}%` }} />
      </div>
    </div>
  );
}
