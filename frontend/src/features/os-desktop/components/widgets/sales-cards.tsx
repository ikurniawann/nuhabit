"use client";

import { buildAskDoPrompt } from "@/lib/desktop/ask-do";
import { PERIOD_LABELS } from "@/lib/desktop/period";
import { WEEKDAY_SHORT, deltaPct, formatRupiah } from "../../lib/format";
import { MiniDelta, MonitorCard, type CardContext } from "./monitor-card";

/** Kartu monitoring penjualan: pendapatan, promo, tamu di meja, ringkasan transaksi. */

export function RevenueCard({ d, periode, failed, go, onAskDo }: CardContext) {
  const omzet = d.omzetPeriode;
  const pct = omzet ? deltaPct(omzet.omzet, omzet.banding.omzet) : null;
  return (
    <MonitorCard
      wide
      title="Pendapatan"
      subtitle={`${PERIOD_LABELS[periode]} · F&B + B2B`}
      href="/dashboard/pos"
      onGo={go}
      onAskDo={onAskDo}
      askDoPrompt={buildAskDoPrompt("omzet", d)}
      failed={failed.has("omzetPeriode")}
    >
      {omzet &&
        (omzet.adaData ? (
          <div>
            <div className="text-[28px] font-extrabold leading-tight tracking-tight">
              {formatRupiah(omzet.omzet)}
              {pct !== null && (
                <span className={`ml-2 align-middle text-[11px] font-bold ${pct >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
                  {pct >= 0 ? "+" : ""}
                  {pct}%
                </span>
              )}
            </div>

            {/* Komposisi sumber: batang tunggal, karena yang dicari owner
                adalah proporsi, bukan nilai absolut per sumber. */}
            <div className="mt-3 flex h-1.5 overflow-hidden rounded-full bg-white/10">
              {omzet.sumber.map((s) => (
                <div key={s.kunci} style={{ width: `${s.porsi}%` }} className={s.kunci === "fnb" ? "bg-accent" : "bg-white/55"} />
              ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
              {omzet.sumber.map((s) => (
                <span key={s.kunci} className="text-[10px] text-white/50">
                  <span className={`mr-1.5 inline-block h-2 w-2 rounded-full align-middle ${s.kunci === "fnb" ? "bg-accent" : "bg-white/55"}`} />
                  {s.label} {s.porsi}% · {formatRupiah(s.nilai)}
                </span>
              ))}
            </div>

            {periode !== "today" && (
              <div className="mt-2 text-[10px] text-white/40">Proyeksi akhir periode {formatRupiah(omzet.proyeksi)}</div>
            )}
          </div>
        ) : (
          /* Tegas dibedakan dari "Rp 0": belum ada transaksi tercatat sama sekali. */
          <div className="text-[11px] text-white/40">Belum ada transaksi tercatat pada periode ini.</div>
        ))}
    </MonitorCard>
  );
}

export function PromoCard({ d, periode, failed, go, onAskDo }: CardContext) {
  const promo = d.dampakPromo;
  return (
    <MonitorCard
      title="Dampak Promo"
      subtitle={PERIOD_LABELS[periode]}
      href="/dashboard/promo"
      onGo={go}
      onAskDo={onAskDo}
      askDoPrompt={buildAskDoPrompt("promo", d)}
      failed={failed.has("dampakPromo")}
    >
      {promo &&
        (promo.adaData ? (
          <div>
            <div className="text-[11px] text-white/40">Diskon diberikan</div>
            <div className="text-[22px] font-extrabold leading-tight tracking-tight">{formatRupiah(promo.diskon)}</div>
            <div className="mt-1 text-[10px] leading-relaxed text-white/50">
              membawa {formatRupiah(promo.omzetTerbawa)} omzet dari {promo.redemption}× pemakaian
              {promo.efisiensi !== null && (
                <>
                  {" "}
                  · <span className={promo.efisiensi >= 1 ? "text-emerald-300" : "text-rose-300"}>{promo.efisiensi}× lipat</span>
                </>
              )}
            </div>
            {promo.teratas.length > 1 && (
              <ul className="mt-2 space-y-1 border-t border-white/10 pt-2">
                {promo.teratas.slice(0, 3).map((k) => (
                  <li key={k.kampanye} className="flex justify-between text-[10px] text-white/50">
                    <span className="truncate pr-2">{k.kampanye}</span>
                    <span className="shrink-0">{formatRupiah(k.diskon)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <div className="text-[11px] text-white/40">Belum ada promo dipakai pada periode ini.</div>
        ))}
    </MonitorCard>
  );
}

export function GuestsCard({ d, failed, go, onAskDo }: CardContext) {
  const tamu = d.tamuDiMeja;
  return (
    <MonitorCard
      title="Tamu di Meja"
      subtitle="Sedang duduk saat ini"
      href="/dashboard/pos/restaurant"
      onGo={go}
      onAskDo={onAskDo}
      askDoPrompt={buildAskDoPrompt("tamu", d)}
      failed={failed.has("tamuDiMeja")}
    >
      {tamu && (
        <div>
          <div className="text-[28px] font-extrabold leading-tight tracking-tight">
            {tamu.tamu}
            <span className="ml-1.5 align-middle text-[11px] font-bold text-white/40">tamu</span>
          </div>
          <div className="mt-1 text-[10px] leading-relaxed text-white/50">
            {tamu.meja === 0 ? (
              "Belum ada meja terisi"
            ) : (
              <>
                di {tamu.meja} meja
                {tamu.kapasitas > 0 && <> · kapasitas terpakai {tamu.kapasitas} kursi</>}
              </>
            )}
          </div>
        </div>
      )}
    </MonitorCard>
  );
}

export function PulseCard({ d, failed, go, onAskDo }: CardContext) {
  const pulsa = d.pulsaBisnis;
  const pct = pulsa ? deltaPct(pulsa.hariIni.omzet, pulsa.kemarin.omzet) : null;
  const maxDay = pulsa ? Math.max(...pulsa.tujuhHari.map((h) => h.omzet), 1) : 1;
  return (
    <MonitorCard
      wide
      title="Ringkasan Transaksi"
      subtitle="POS · hari ini vs kemarin"
      href="/dashboard/pos"
      onGo={go}
      onAskDo={onAskDo}
      askDoPrompt={buildAskDoPrompt("pulsa", d)}
      failed={failed.has("pulsaBisnis")}
    >
      {pulsa && (
        <div className="grid grid-cols-1 items-end gap-4 min-[430px]:grid-cols-[1.2fr_1fr]">
          <div>
            <div className="text-[11px] text-white/40">Omzet hari ini</div>
            <div className="text-[28px] font-extrabold leading-tight tracking-tight">
              {formatRupiah(pulsa.hariIni.omzet)}
              {pct !== null && (
                <span
                  className={`ml-2 inline-flex -translate-y-1 items-center rounded-full border px-2 py-0.5 align-middle text-[11px] font-bold ${pct >= 0 ? "border-emerald-400/30 bg-emerald-400/12 text-emerald-200" : "border-rose-400/30 bg-rose-400/12 text-rose-200"}`}
                >
                  {pct >= 0 ? "▲" : "▼"} {Math.abs(pct)}%
                </span>
              )}
            </div>
            <div className="mt-2.5 flex flex-wrap gap-x-5 gap-y-2 text-[11px]">
              <div>
                <div className="text-white/40">Pesanan</div>
                <div className="mt-0.5 text-sm font-bold">{pulsa.hariIni.pesanan}</div>
              </div>
              {pulsa.labaKotorHariIni && (
                <div>
                  <div className="text-white/40">
                    Laba kotor
                    {pulsa.labaKotorHariIni.itemTanpaModal > 0 && (
                      <span
                        className="ml-1 cursor-help text-amber-300/80"
                        title={`${pulsa.labaKotorHariIni.itemTanpaModal} item belum punya harga modal — laba kotor lebih tinggi dari seharusnya`}
                      >
                        ⚠
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 text-sm font-bold">{formatRupiah(pulsa.labaKotorHariIni.laba)}</div>
                </div>
              )}
              <div>
                <div className="text-white/40">Rata-rata</div>
                <div className="mt-0.5 text-sm font-bold">{formatRupiah(pulsa.hariIni.rataRata)}</div>
              </div>
              <div>
                <div className="text-white/40">Kemarin</div>
                <div className="mt-0.5 text-sm font-bold text-white/60">
                  {formatRupiah(pulsa.kemarin.omzet)}
                  <MiniDelta current={pulsa.hariIni.omzet} base={pulsa.kemarin.omzet} />
                </div>
              </div>
              <div>
                {/* Pembanding pola mingguan: hari yang sama pekan lalu. */}
                <div className="text-white/40">Minggu lalu</div>
                <div className="mt-0.5 text-sm font-bold text-white/60">
                  {formatRupiah(pulsa.mingguLalu.omzet)}
                  <MiniDelta current={pulsa.hariIni.omzet} base={pulsa.mingguLalu.omzet} />
                </div>
              </div>
            </div>
          </div>
          <div>
            <div className="flex h-14 items-end gap-1">
              {pulsa.tujuhHari.map((h, i) => (
                <span
                  key={h.tanggal}
                  title={`${h.tanggal}: ${formatRupiah(h.omzet)}`}
                  style={{ height: `${Math.max(8, (h.omzet / maxDay) * 100)}%` }}
                  className={`min-w-[10px] flex-1 rounded-t-md ${i === 6 ? "bg-accent shadow-[0_0_14px_rgba(218,255,89,.45)]" : "bg-gradient-to-t from-pink-500/40 to-pink-300/80"}`}
                />
              ))}
            </div>
            <div className="mt-1 flex gap-1">
              {pulsa.tujuhHari.map((h) => (
                <span key={h.tanggal} className="min-w-[10px] flex-1 text-center text-[9px] text-white/35">
                  {WEEKDAY_SHORT[new Date(`${h.tanggal}T00:00:00`).getDay()]}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
    </MonitorCard>
  );
}
