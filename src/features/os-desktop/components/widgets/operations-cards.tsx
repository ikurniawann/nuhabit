"use client";

import { buildAskDoPrompt } from "@/lib/desktop/ask-do";
import { MonitorCard, type CardContext } from "./monitor-card";

/** Kartu monitoring operasional: tim, keputusan, stok, member. */

export function TeamCard({ d, failed, go, onAskDo }: CardContext) {
  const tim = d.timHariIni;
  const share = (n: number) => (tim && tim.aktif > 0 ? `${(n / tim.aktif) * 100}%` : "0%");
  return (
    <MonitorCard
      title="Tim Hari Ini"
      subtitle={`${tim?.aktif ?? "–"} karyawan aktif`}
      href="/dashboard/hris/attendance"
      onGo={go}
      onAskDo={onAskDo}
      askDoPrompt={buildAskDoPrompt("tim", d)}
      failed={failed.has("timHariIni")}
    >
      {tim && (
        <>
          <div className="flex gap-1.5">
            {[
              { n: tim.hadir, t: "Hadir", c: "text-emerald-300" },
              { n: tim.terlambat, t: "Telat", c: "text-amber-300" },
              { n: tim.belum, t: "Belum", c: "text-rose-300" },
              { n: tim.cuti, t: "Cuti", c: "text-sky-300" },
            ].map((p) => (
              <div key={p.t} className="flex-1 rounded-xl border border-white/8 bg-white/5 px-1 py-2 text-center">
                <div className={`text-lg font-extrabold ${p.c}`}>{p.n}</div>
                <div className="text-[9.5px] text-white/40">{p.t}</div>
              </div>
            ))}
          </div>
          {tim.aktif > 0 && (
            <div className="mt-2.5 flex h-1.5 overflow-hidden rounded-full bg-white/8">
              <i style={{ width: share(tim.hadir) }} className="bg-emerald-400" />
              <i style={{ width: share(tim.terlambat) }} className="bg-amber-400" />
              <i style={{ width: share(tim.belum) }} className="bg-rose-400" />
              <i style={{ width: share(tim.cuti) }} className="bg-sky-400" />
            </div>
          )}
        </>
      )}
    </MonitorCard>
  );
}

export function DecisionsCard({ d, failed, go, onAskDo, onOpenInbox }: CardContext) {
  const keputusan = d.perluKeputusan;
  return (
    <MonitorCard
      title="Perlu Keputusan"
      subtitle={`${keputusan?.total ?? "–"} item menunggu`}
      href="/dashboard/hris/leaves"
      onGo={go}
      onAskDo={onAskDo}
      askDoPrompt={buildAskDoPrompt("keputusan", d)}
      failed={failed.has("perluKeputusan")}
    >
      {onOpenInbox && (keputusan?.total ?? 0) > 0 && (
        <button
          type="button"
          onClick={onOpenInbox}
          className="mb-2 w-full rounded-xl bg-pink-600/85 px-3 py-2 text-xs font-bold text-white transition hover:bg-pink-500"
        >
          Tangani sekarang
        </button>
      )}
      {keputusan && (
        <div className="-mx-1 flex flex-col">
          {[
            { t: "Pengajuan cuti", n: keputusan.cuti, href: "/dashboard/hris/leaves" },
            { t: "Lembur & pinjaman", n: keputusan.lembur + keputusan.pinjaman, href: "/dashboard/hris/overtime" },
            { t: "PO draft menunggu", n: keputusan.poDraft, href: "/dashboard/purchasing/approval" },
            { t: "Kandidat baru", n: keputusan.kandidatBaru, href: "/dashboard/hris/candidates" },
          ].map((r) => (
            <button
              key={r.t}
              type="button"
              onClick={() => go(r.href)}
              className="flex items-center gap-2.5 rounded-xl px-2 py-1.5 text-left transition hover:bg-white/8"
            >
              <span className="min-w-0 flex-1 truncate text-xs">{r.t}</span>
              <span
                className={`grid h-5 min-w-5 shrink-0 place-items-center rounded-full px-1.5 text-[11px] font-extrabold ${r.n > 0 ? "bg-accent text-accent-foreground" : "bg-white/8 text-white/35"}`}
              >
                {r.n}
              </span>
              <span className="shrink-0 text-white/30">›</span>
            </button>
          ))}
        </div>
      )}
    </MonitorCard>
  );
}

export function StockCard({ d, failed, go, onAskDo }: CardContext) {
  const stok = d.stokMenipis;
  const subtitle = stok ? (stok.jumlah > 0 ? `${stok.jumlah} bahan di bawah minimum` : "Semua stok aman") : "–";
  return (
    <MonitorCard
      title="Stok Menipis"
      subtitle={subtitle}
      href="/dashboard/inventory/low-stock"
      onGo={go}
      onAskDo={onAskDo}
      askDoPrompt={buildAskDoPrompt("stok", d)}
      failed={failed.has("stokMenipis")}
    >
      {stok &&
        (stok.jumlah === 0 ? (
          <div className="rounded-2xl bg-emerald-400/8 px-3 py-2.5 text-xs text-emerald-200">Tidak ada bahan di bawah batas minimum.</div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {stok.teratas.map((item) => (
              <div key={item.bahan}>
                <div className="mb-1 flex justify-between text-[11.5px]">
                  <span className="truncate font-semibold">{item.bahan}</span>
                  <span className="shrink-0 text-white/40">
                    {item.tersedia} / min {item.minimum}
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-white/8">
                  <i
                    style={{ width: `${item.minimum > 0 ? Math.min(100, (item.tersedia / item.minimum) * 100) : 0}%` }}
                    className="block h-full rounded-full bg-gradient-to-r from-rose-400 to-amber-400"
                  />
                </div>
              </div>
            ))}
          </div>
        ))}
    </MonitorCard>
  );
}

export function MemberCard({ d, failed, go, onAskDo }: CardContext) {
  const member = d.member;
  return (
    <MonitorCard
      title="Member & Loyalty"
      subtitle="7 hari terakhir"
      href="/dashboard/crm/members"
      onGo={go}
      onAskDo={onAskDo}
      askDoPrompt={buildAskDoPrompt("member", d)}
      failed={failed.has("member")}
    >
      {member && (
        <div className="grid grid-cols-3 gap-2">
          {[
            { n: member.memberBaru7Hari, t: "Member baru" },
            { n: member.xpTerdistribusi7Hari.toLocaleString("id-ID"), t: "XP keluar" },
            { n: member.rewardDitukar7Hari, t: "Reward ditukar" },
          ].map((c) => (
            <div key={c.t} className="rounded-xl border border-white/8 bg-white/5 px-2 py-2.5 text-center">
              <div className="text-base font-extrabold">{c.n}</div>
              <div className="mt-0.5 text-[9.5px] leading-tight text-white/40">{c.t}</div>
            </div>
          ))}
        </div>
      )}
    </MonitorCard>
  );
}
