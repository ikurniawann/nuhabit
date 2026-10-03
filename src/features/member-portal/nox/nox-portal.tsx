"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import "./nox.css";
import { isCreditEntry } from "@/lib/wallet/ledger";
import { useNoxMember } from "./use-nox-member";
import { angka, tanggal, TXN_LABELS } from "../format";
import { useMemberDetails } from "../use-member-details";
import { useMemberOtp } from "../use-member-otp";
import { idrToArkDisplay, isArkCoinMethod } from "@/lib/pos/loyalty-settings";

/**
 * Portal member "Nox Lab" — port React dari prototipe membernox.html.
 *
 * Fase A: paritas visual. Fase B (ini): data nyata dari API portal member —
 * profil, XP/tier, saldo ARK Coin, riwayat. Sesi memakai cookie member_session
 * dari login OTP portal klasik (/member); login OTP di dalam Nox = Fase C,
 * adaptasi mobile = Fase D.
 *
 * Keputusan owner 2026-08-15: Missions/Streak/Shards disembunyikan (belum ada
 * backend). "Level" prototipe dipetakan ke TIER membership — satu-satunya
 * tangga kemajuan yang nyata di sistem.
 */

const MODES = ["dashboard", "profile", "coins", "history"] as const;
type NoxMode = (typeof MODES)[number];

const MODE_LABELS: Record<NoxMode, string> = {
  dashboard: "Citizen dashboard",
  profile: "Profile",
  coins: "ARK Coins",
  history: "History",
};

/** Teks lore hotspot — flavor dunia, disalin apa adanya dari prototipe. */
const LORE: Record<string, { tag: string; title: string; text: string }> = {
  terminal: {
    tag: "NOX LAB OBJECT / 01",
    title: "Lab Terminal",
    text: "A citizen-facing terminal that translates activity across Wounderland into visible progress. In a production version, this can become a contextual entrance into missions, XP and account status.",
  },
  archive: {
    tag: "NOX LAB OBJECT / 02",
    title: "Archive Shelf",
    text: "The archive is a bridge between profile data and worldbuilding. Rewards, discovered items, campaign artifacts and hidden lore can live here rather than being presented as a conventional inventory grid.",
  },
  bed: {
    tag: "NOX LAB OBJECT / 03",
    title: "Nox Rest Zone",
    text: "A quieter corner of the lab. It can surface streaks, reflection prompts, saved moments or low-pressure return mechanics—giving the dashboard different emotional tempos.",
  },
};

export function NoxPortal() {
  const { state, reload } = useNoxMember();
  const [mode, setMode] = useState<NoxMode>("dashboard");
  const [entered, setEntered] = useState(false);
  const [lore, setLore] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  /* Dialog detail (keputusan owner 2026-08-18): nomor transaksi di History
   * serta baris Nama/Tier/Kunjungan di Profile bisa diklik. Order & kunjungan
   * di-fetch saat dialog dibuka; profil & tier sudah ada di state member. */
  const [detail, setDetail] = useState<
    | { type: "order"; id: string; nomor: string }
    | { type: "profile" }
    | { type: "tier" }
    | { type: "visits" }
    | null
  >(null);
  const details = useMemberDetails();
  const { order: orderDetail, visits: visitsData, busy: detailBusy, error: detailError } = details;

  const openOrderDetail = useCallback(
    (id: string, nomor: string) => {
      setDetail({ type: "order", id, nomor });
      return details.loadOrder(id);
    },
    [details]
  );

  const openVisits = useCallback(() => {
    setDetail({ type: "visits" });
    return details.loadVisits();
  }, [details]);

  /* Login OTP di dalam Nox (Fase C) — memakai endpoint portal member yang
   * sudah ada: POST /otp {phone} lalu POST /verify {phone, code} yang
   * menanam cookie member_session. Setelah verifikasi, reload() menarik
   * profil dan layar entry berubah menjadi sapaan. */
  const appRef = useRef<HTMLDivElement>(null);
  const labBgRef = useRef<HTMLDivElement>(null);
  const charWrapRef = useRef<HTMLDivElement>(null);
  const cursorDotRef = useRef<HTMLDivElement>(null);
  const cursorRingRef = useRef<HTMLDivElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wheelLock = useRef(false);
  // Nilai per-frame disimpan di ref, bukan state: loop rAF menulis 60x/detik
  // dan tidak boleh memicu render React.
  const anim = useRef({
    mouseX: 0.5,
    mouseY: 0.5,
    dotX: 0,
    dotY: 0,
    ringX: 0,
    ringY: 0,
    cameraX: 0,
    cameraY: 0,
    drag: false,
    dragX: 0,
    dragY: 0,
  });

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 1800);
  }, []);

  const goMode = useCallback(
    (next: NoxMode, fromScroll = false) => {
      setMode((prev) => {
        if (prev === next) return prev;
        const app = appRef.current;
        if (app) {
          app.classList.add("transitioning");
          setTimeout(() => app.classList.remove("transitioning"), 420);
        }
        if (!fromScroll) showToast(MODE_LABELS[next]);
        return next;
      });
    },
    [showToast]
  );

  const otp = useMemberOtp({
    onSignedIn: (bypass) => {
      reload();
      showToast(bypass ? "Masuk tanpa OTP (mode dev lokal)" : "Selamat datang, Citizen");
    },
    onCodeSent: () => showToast("Kode OTP dikirim ke WhatsApp Anda"),
  });

  const logout = useCallback(async () => {
    await fetch("/api/member-portal/logout", { method: "POST" }).catch(() => {});
    setEntered(false);
    setMode("dashboard");
    reload();
    showToast("Sampai jumpa, Citizen");
  }, [reload, showToast]);

  /* Scroll & keyboard memindahkan mode — meniru prototipe, dengan kunci 760ms
   * supaya satu gulungan momentum tidak melompati beberapa mode sekaligus. */
  useEffect(() => {
    const stepFrom = (dir: 1 | -1) => {
      setMode((prev) => {
        const idx = MODES.indexOf(prev);
        const next = MODES[Math.max(0, Math.min(MODES.length - 1, idx + dir))];
        if (next !== prev) {
          const app = appRef.current;
          if (app) {
            app.classList.add("transitioning");
            setTimeout(() => app.classList.remove("transitioning"), 420);
          }
        }
        return next;
      });
    };

    const onWheel = (e: WheelEvent) => {
      if (!entered || wheelLock.current || lore || detail) return;
      if (Math.abs(e.deltaY) < 18) return;
      wheelLock.current = true;
      stepFrom(e.deltaY > 0 ? 1 : -1);
      setTimeout(() => (wheelLock.current = false), 760);
    };
    const onKey = (e: KeyboardEvent) => {
      if (!entered) return;
      if (e.key === "Escape") {
        setLore(null);
        setDetail(null);
        return;
      }
      if (detail) return; // panah utk scroll isi dialog, bukan pindah mode
      if (["ArrowDown", "PageDown", "ArrowRight"].includes(e.key)) stepFrom(1);
      if (["ArrowUp", "PageUp", "ArrowLeft"].includes(e.key)) stepFrom(-1);
    };
    window.addEventListener("wheel", onWheel, { passive: true });
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKey);
    };
  }, [entered, lore, detail]);

  /* Parallax + kursor kustom: satu loop rAF menggerakkan latar, karakter, dan
   * cincin kursor. Di layar sentuh loop tetap jalan (untuk parallax netral)
   * tapi elemen kursornya disembunyikan. */
  useEffect(() => {
    const a = anim.current;
    const isCoarse = window.matchMedia("(pointer:coarse)").matches;
    if (isCoarse) {
      if (cursorDotRef.current) cursorDotRef.current.style.display = "none";
      if (cursorRingRef.current) cursorRingRef.current.style.display = "none";
    }

    const onMove = (e: MouseEvent) => {
      a.mouseX = e.clientX / window.innerWidth;
      a.mouseY = e.clientY / window.innerHeight;
      a.dotX = e.clientX;
      a.dotY = e.clientY;
      if (cursorDotRef.current) {
        cursorDotRef.current.style.transform = `translate(${a.dotX - 2.5}px,${a.dotY - 2.5}px)`;
      }
      if (a.drag) {
        a.cameraX = Math.max(-20, Math.min(20, (e.clientX - a.dragX) * 0.035));
        a.cameraY = Math.max(-12, Math.min(12, (e.clientY - a.dragY) * 0.025));
      }
      const el = e.target instanceof Element ? e.target.closest(".interactive") : null;
      cursorRingRef.current?.classList.toggle("active", Boolean(el) || a.drag);
    };
    const onDown = (e: MouseEvent) => {
      if (e.target instanceof Element && e.target.closest("button,.glass,.stat-glass,.hotspot")) return;
      a.drag = true;
      a.dragX = e.clientX;
      a.dragY = e.clientY;
    };
    const onUp = () => {
      a.drag = false;
      a.cameraX *= 0.25;
      a.cameraY *= 0.25;
    };

    let raf = 0;
    const loop = () => {
      a.ringX += (a.dotX - a.ringX) * 0.15;
      a.ringY += (a.dotY - a.ringY) * 0.15;
      if (cursorRingRef.current) {
        cursorRingRef.current.style.transform = `translate(${a.ringX - 17}px,${a.ringY - 17}px)`;
      }
      if (labBgRef.current) {
        labBgRef.current.style.marginLeft = `${(a.mouseX - 0.5) * 10 + a.cameraX}px`;
        labBgRef.current.style.marginTop = `${(a.mouseY - 0.5) * 6 + a.cameraY}px`;
      }
      if (charWrapRef.current) {
        charWrapRef.current.style.marginLeft = `${(a.mouseX - 0.5) * -10}px`;
        charWrapRef.current.style.marginBottom = `${(a.mouseY - 0.5) * -5}px`;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("mouseup", onUp);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  const modeIndex = MODES.indexOf(mode);

  /* ── Turunan data tampilan ─────────────────────────────────────────── */
  const ready = state.status === "ready" ? state : null;
  const member = ready?.member ?? null;
  const coins = member ? angka(member.coins) : "—";
  const coinsRp = member ? angka(member.coinsIdr) : null;
  const displayName = (member?.profile.name || member?.profile.phone || "CITIZEN").toUpperCase();

  // "Level" prototipe = tier membership. Progres bar = posisi XP di antara
  // tier sekarang dan ambang tier berikutnya; tier tertinggi = bar penuh.
  const totalXp = member?.totalXp ?? 0;
  const nextTier = member?.nextTier ?? null;
  const xpTarget = nextTier?.minLifetimeXp ?? totalXp;
  const xpPct = nextTier && xpTarget > 0 ? Math.min(100, (totalXp / xpTarget) * 100) : 100;

  const activeLore = lore ? LORE[lore] : null;

  return (
    <div id="app" ref={appRef} data-mode={mode}>
      <div className="world">
        <div className="lab-bg" ref={labBgRef} />
        <div className="ambient a" />
        <div className="ambient b" />
        <div className="scanlines" />
        <div className="noise" />
      </div>

      <div className="shadow" />
      <div className="character-wrap" ref={charWrapRef}>
        {/* next/image tidak dipakai: elemen ini digeser tiap frame oleh loop
            parallax dan butuh ukuran intrinsik CSS prototipe apa adanya. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="character" src="/member-nox/character.webp" alt="SULU Nox character" />
      </div>

      <header className="topbar">
        <div className="brand">
          <Image src="/member-nox/logo.webp?v=3" alt="NüHabit" width={139} height={115} unoptimized />
        </div>
        <div className="hud">
          <div className="hud-chip">
            <div className="hud-icon">A</div>
            <div className="hud-copy">
              <small>ARK Coins</small>
              <strong>{coins}</strong>
            </div>
          </div>
          <button
            className="icon-btn interactive"
            aria-label="Citizen profile"
            onClick={() => goMode("profile")}
          >
            ◉
          </button>
        </div>
      </header>

      <nav className="navrail" aria-label="Citizen dashboard sections">
        {MODES.map((m) => (
          <button
            key={m}
            className={`nav-item interactive${mode === m ? " active" : ""}`}
            data-mode={m}
            aria-label={MODE_LABELS[m]}
            onClick={() => goMode(m)}
          >
            {NAV_ICONS[m]}
            <span>{m === "dashboard" ? "Dashboard" : MODE_LABELS[m]}</span>
          </button>
        ))}
        <div className="nav-index">
          {String(modeIndex + 1).padStart(2, "0")} / {String(MODES.length).padStart(2, "0")}
        </div>
      </nav>

      <main className="scene-ui">
        <section className="hero-copy">
          <div className="eyebrow">HEY THERE,</div>
          <h1 className="name">{displayName}</h1>
          <div className="citizen-tag">Citizen of Wounderland</div>
          <div className="stat-glass interactive" data-cursor="OPEN">
            <div className="level-row">
              <div className="level">
                <small>Tier</small>
                <strong>{member?.tier?.name ?? "—"}</strong>
              </div>
              <div className="xp">
                <small>
                  XP · {angka(totalXp)}
                  {nextTier ? ` / ${angka(nextTier.minLifetimeXp)}` : ""}
                </small>
                <div className="xpbar">
                  <span style={{ width: `${xpPct}%` }} />
                </div>
                <div className="xp-meta">
                  {nextTier ? (
                    <>
                      <span>Next: {nextTier.name}</span>
                      <span>{angka(nextTier.xpNeeded)} XP to go</span>
                    </>
                  ) : (
                    <span>Tier tertinggi tercapai</span>
                  )}
                </div>
              </div>
            </div>
          </div>
          <div className="quote">
            <b>“</b>&nbsp; Not perfect yet.
            <br />
            But getting better.
          </div>
        </section>

        <aside className="side-stack">
          <section className="glass card interactive wallet-card" data-cursor="OPEN">
            <div className="card-head">
              <h3>ARK Wallet</h3>
              <small>Citizen balance</small>
            </div>
            <div className="wallet">
              <div className="coin-big">
                <div className="coin-medal">A</div>
                <div>
                  <small>Current balance</small>
                  <strong>{coins}</strong>
                  {coinsRp !== null && <small className="wallet-rp">≈ Rp {coinsRp}</small>}
                </div>
              </div>
              <button className="action interactive" onClick={() => goMode("coins")}>
                Lihat →
              </button>
            </div>
            <div className="wallet-hint">Top-up di kasir mana pun</div>
          </section>
        </aside>

        <section className="glass bottom-tray">
          <div className="quick">
            <button className="interactive" onClick={() => goMode("coins")}>
              ARK Coins
            </button>
            <button className="interactive" onClick={() => goMode("history")}>
              History
            </button>
          </div>
        </section>

        <section className={`mode-panel glass card${mode === "profile" ? " active" : ""}`} data-panel="profile">
          <h2>Citizen Profile</h2>
          <p className="sub">Your identity inside Wounderland.</p>
          <div className="list">
            <div
              className="list-row interactive"
              role="button"
              tabIndex={0}
              onClick={() => setDetail({ type: "profile" })}
              onKeyDown={(e) => e.key === "Enter" && setDetail({ type: "profile" })}
            >
              <div className="list-icon">ID</div>
              <div>
                <b>{member?.profile.name ?? "Citizen"}</b>
                <small>{member?.profile.phone ?? "—"}</small>
              </div>
              <span className="pill">{member?.memberType === "card" ? "Kartu" : "Member"}</span>
            </div>
            <div
              className="list-row interactive"
              role="button"
              tabIndex={0}
              onClick={() => setDetail({ type: "tier" })}
              onKeyDown={(e) => e.key === "Enter" && setDetail({ type: "tier" })}
            >
              <div className="list-icon">✦</div>
              <div>
                <b>{member?.tier?.name ?? "Tier"}</b>
                <small>
                  {member?.tier
                    ? `Diskon member ${member.tier.discountPercent}%`
                    : "Membership saat ini"}
                </small>
              </div>
              <span className="pill">{angka(totalXp)} XP</span>
            </div>
            <div
              className="list-row interactive"
              role="button"
              tabIndex={0}
              onClick={() => void openVisits()}
              onKeyDown={(e) => e.key === "Enter" && void openVisits()}
            >
              <div className="list-icon">↗</div>
              <div>
                <b>Kunjungan</b>
                <small>Total tercatat</small>
              </div>
              <span className="pill">{member ? angka(member.visitCount) : "—"}</span>
            </div>
            <div
              className="list-row interactive"
              role="button"
              tabIndex={0}
              onClick={() => void logout()}
              onKeyDown={(e) => e.key === "Enter" && void logout()}
            >
              <div className="list-icon">×</div>
              <div>
                <b>Keluar</b>
                <small>Akhiri sesi portal ini</small>
              </div>
            </div>
          </div>
        </section>

        <section className={`mode-panel glass card${mode === "coins" ? " active" : ""}`} data-panel="coins">
          <h2>ARK Coin Wallet</h2>
          <p className="sub">Saldo yang bisa dibelanjakan di seluruh venue. Top-up dilakukan di kasir.</p>
          <div className="wallet" style={{ marginBottom: 15 }}>
            <div className="coin-big">
              <div className="coin-medal">A</div>
              <div>
                <small>Current balance</small>
                <strong>{coins}</strong>
                {coinsRp !== null && <small className="wallet-rp">≈ Rp {coinsRp}</small>}
              </div>
            </div>
          </div>
          <div className="list">
            {ready && ready.wallet.length === 0 && (
              <div className="list-row">
                <div className="list-icon">A</div>
                <div>
                  <b>Belum ada transaksi koin</b>
                  <small>Top-up pertama Anda akan tampil di sini</small>
                </div>
              </div>
            )}
            {ready?.wallet.slice(0, 6).map((txn) => {
              const kredit = isCreditEntry(txn.type, txn.amount);
              return (
                <div className="list-row" key={txn.id}>
                  <div className="list-icon">{kredit ? "✦" : "A"}</div>
                  <div>
                    <b>{TXN_LABELS[txn.type] ?? txn.type}</b>
                    <small>{tanggal(txn.createdAt)}</small>
                  </div>
                  {/* Math.abs: amount debit sudah negatif dari API — tanpa ini
                      tanda minus dobel ("−-2") tercetak di riwayat. */}
                  <strong className={`tx-amount ${kredit ? "pos" : "neg"}`}>
                    {kredit ? "+" : "−"}
                    {angka(Math.abs(txn.amount))}
                  </strong>
                </div>
              );
            })}
          </div>
        </section>

        <section className={`mode-panel glass card${mode === "history" ? " active" : ""}`} data-panel="history">
          <h2>Citizen History</h2>
          <p className="sub">Arsip transaksi Anda di Wounderland.</p>
          <div className="list">
            {ready && ready.orders.length === 0 && (
              <div className="list-row">
                <div className="list-icon">↗</div>
                <div>
                  <b>Belum ada transaksi</b>
                  <small>Kunjungan pertama Anda akan tercatat di sini</small>
                </div>
              </div>
            )}
            {ready?.orders.slice(0, 6).map((order) => (
              <div
                className="list-row interactive"
                key={order.id}
                role="button"
                tabIndex={0}
                onClick={() => void openOrderDetail(order.id, order.orderNumber)}
                onKeyDown={(e) => e.key === "Enter" && void openOrderDetail(order.id, order.orderNumber)}
              >
                <div className="list-icon">A</div>
                <div>
                  <b>{order.orderNumber}</b>
                  <small>{tanggal(order.createdAt)}</small>
                </div>
                <span className="pill">
                  {order.unit === "ark"
                    ? `Rp ${angka(order.totalIdr)} / ${angka(order.totalAmount)} ARK`
                    : `Rp ${angka(order.totalAmount)}`}
                </span>
              </div>
            ))}
          </div>
        </section>
      </main>

      {Object.keys(LORE).map((key) => (
        <button
          key={key}
          className={`hotspot h-${key} interactive`}
          data-label={LORE[key].title}
          aria-label={`Open ${LORE[key].title} lore`}
          onClick={() => setLore(key)}
        />
      ))}

      <div className="journey" aria-label="Section progress">
        {MODES.map((m) => (
          <button
            key={m}
            className={mode === m ? "active" : ""}
            aria-label={MODE_LABELS[m]}
            onClick={() => goMode(m)}
          />
        ))}
      </div>
      <div className="scroll-hint">
        <span className="wheel" /> Scroll to travel through your citizen profile
      </div>
      <div className={`toast${toast ? " show" : ""}`} aria-live="polite">
        {toast}
      </div>

      <div className={`overlay${activeLore ? " open" : ""}`} onClick={() => setLore(null)}>
        {activeLore && (
          <div className="lore" onClick={(e) => e.stopPropagation()}>
            <button className="close interactive" aria-label="Close" onClick={() => setLore(null)}>
              ×
            </button>
            <div className="tagline">{activeLore.tag}</div>
            <h2>{activeLore.title}</h2>
            <p>{activeLore.text}</p>
          </div>
        )}
      </div>

      {/* Dialog detail: order / profil / tier / kunjungan — kaca yang sama
          dengan lore, isi berbeda. Tutup: backdrop, tombol ×, atau Escape. */}
      <div className={`overlay${detail ? " open" : ""}`} onClick={() => setDetail(null)}>
        {detail && (
          <div className="lore detail" onClick={(e) => e.stopPropagation()}>
            <button className="close interactive" aria-label="Close" onClick={() => setDetail(null)}>
              ×
            </button>

            {detail.type === "order" && (
              <>
                <div className="tagline">Citizen History / Detail</div>
                <h2>{detail.nomor}</h2>
                {detailBusy && <p>Memuat detail…</p>}
                {detailError && <p className="detail-error">{detailError}</p>}
                {orderDetail && (() => {
                  /* Samakan dengan struk kasir (keputusan owner 2026-08-23):
                     transaksi ARK Coin menampilkan konversi "Rp X / N Ark
                     Coin" di tiap item, Subtotal, Total, plus Dibayar ARK. */
                  const pakaiArk = isArkCoinMethod(orderDetail.order.payment_method);
                  const keArk = (idr: number) =>
                    `${angka(idrToArkDisplay(idr, orderDetail.ark_rate))} Ark Coin`;
                  const hargaRp = (idr: number) =>
                    pakaiArk ? `Rp ${angka(idr)} / ${keArk(idr)}` : `Rp ${angka(idr)}`;
                  const arkDibayar =
                    orderDetail.order.ark_coins_used || orderDetail.order.total_amount;
                  return (
                  <>
                    <p>
                      {tanggal(orderDetail.order.ordered_at)}
                      {orderDetail.order.venue_name ? ` · ${orderDetail.order.venue_name}` : ""}
                    </p>
                    <div className="detail-rows">
                      {orderDetail.items.map((item, i) => (
                        <div className="detail-row" key={i}>
                          <span>
                            {angka(item.quantity)}x {item.product_name}
                            <small>
                              @ Rp {angka(item.unit_price)}
                              {item.discount_amount > 0
                                ? ` · diskon Rp ${angka(item.discount_amount)}`
                                : ""}
                            </small>
                          </span>
                          <b>{hargaRp(item.total_amount)}</b>
                        </div>
                      ))}
                      <div className="detail-row sum">
                        <span>Subtotal</span>
                        <b>{hargaRp(orderDetail.order.subtotal)}</b>
                      </div>
                      {orderDetail.order.discount_amount > 0 && (
                        <div className="detail-row diskon">
                          <span>
                            Diskon
                            {orderDetail.order.discount_reason
                              ? ` (${orderDetail.order.discount_reason})`
                              : ""}
                          </span>
                          <b>−Rp {angka(orderDetail.order.discount_amount)}</b>
                        </div>
                      )}
                      <div className="detail-row total">
                        <span>Total</span>
                        <b>{hargaRp(orderDetail.order.total_amount)}</b>
                      </div>
                      {pakaiArk && (
                        <div className="detail-row">
                          <span>Dibayar ARK</span>
                          <b>{angka(idrToArkDisplay(arkDibayar, orderDetail.ark_rate))} ARK</b>
                        </div>
                      )}
                      {orderDetail.xp_earned > 0 && (
                        <div className="detail-row xp">
                          <span>XP didapat</span>
                          <b>+{angka(orderDetail.xp_earned)} XP</b>
                        </div>
                      )}
                    </div>
                  </>
                  );
                })()}
              </>
            )}

            {detail.type === "profile" && member && (
              <>
                <div className="tagline">Citizen Profile / Detail</div>
                <h2>{member.profile.name ?? "Citizen"}</h2>
                <div className="detail-rows">
                  {(
                    [
                      ["Telepon", member.profile.phone],
                      ["Email", member.profile.email],
                      [
                        "Tanggal lahir",
                        member.profile.birthDate
                          ? new Date(member.profile.birthDate).toLocaleDateString("id-ID", {
                              dateStyle: "long",
                            })
                          : null,
                      ],
                      ["Gender", member.profile.gender],
                      ["Kota", member.profile.city],
                      ["Tipe member", member.memberType === "card" ? "Kartu" : "Terdaftar"],
                      ["Tier", member.tier?.name ?? null],
                    ] as Array<[string, string | null]>
                  ).map(([label, value]) => (
                    <div className="detail-row" key={label}>
                      <span>{label}</span>
                      <b>{value ?? "—"}</b>
                    </div>
                  ))}
                </div>
                <p className="detail-note">
                  Data belum lengkap? Perbarui lewat kasir saat berkunjung.
                </p>
              </>
            )}

            {detail.type === "tier" && member && (
              <>
                <div className="tagline">Citizen Status / XP</div>
                <h2>{member.tier?.name ?? "Tier"}</h2>
                <p>
                  {angka(totalXp)} XP terkumpul
                  {member.nextTier
                    ? ` — ${angka(member.nextTier.xpNeeded)} XP lagi menuju ${member.nextTier.name}`
                    : " — tier tertinggi tercapai"}
                </p>
                <div className="detail-rows">
                  {member.tiers.map((tier) => {
                    const tercapai = totalXp >= tier.minLifetimeXp;
                    const aktif = tier.code === member.tier?.code;
                    return (
                      <div className={`detail-row${aktif ? " total" : ""}`} key={tier.code}>
                        <span>
                          {tercapai ? "✦" : "○"} {tier.name}
                          <small>
                            {angka(tier.minLifetimeXp)} XP · diskon {tier.discountPercent}%
                          </small>
                        </span>
                        <b>{aktif ? "Saat ini" : tercapai ? "Tercapai" : ""}</b>
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            {detail.type === "visits" && (
              <>
                <div className="tagline">Citizen Journey</div>
                <h2>Kunjungan</h2>
                {detailBusy && <p>Memuat…</p>}
                {detailError && <p className="detail-error">{detailError}</p>}
                {visitsData && (
                  <>
                    <p>{angka(visitsData.visit_count)} kunjungan tercatat di Wounderland.</p>
                    <div className="detail-rows">
                      {visitsData.venues.length === 0 && (
                        <div className="detail-row">
                          <span>Belum ada transaksi — kunjungan pertama Anda akan tercatat di sini.</span>
                        </div>
                      )}
                      {visitsData.venues.map((venue) => (
                        <div className="detail-row" key={venue.venue_name}>
                          <span>
                            {venue.venue_name}
                            <small>
                              {angka(venue.order_count)} transaksi · {angka(venue.day_count)} hari
                            </small>
                          </span>
                          <b>{tanggal(venue.last_visit_at)}</b>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Layar entry merangkap gerbang status data:
          - loading: tombol menunggu
          - unauthenticated: arahkan ke login OTP portal klasik (Fase C akan
            memindahkan OTP ke sini)
          - error: coba lagi
          - ready: sapa nama member, tombol masuk */}
      <div className={`entry${entered ? " hide" : ""}`}>
        <div className="entry-inner">
          <Image
            className="entry-logo"
            src="/member-nox/logo.webp?v=3"
            alt="NüHabit"
            width={139}
            height={115}
            unoptimized
          />
          <div className="entry-kicker">Citizen profile / Nox Lab node</div>
          {state.status === "ready" ? (
            <>
              <h1>WELCOME BACK, {displayName}.</h1>
              <p>Profil, XP, dan ARK Coins Anda sudah tersinkron. Masuk untuk menjelajah.</p>
              <div className="entry-line" />
              <button
                className="enter-btn interactive"
                onClick={() => {
                  setEntered(true);
                  setTimeout(() => showToast("Citizen profile synchronized"), 650);
                }}
              >
                Enter Nox Lab
              </button>
            </>
          ) : state.status === "unauthenticated" ? (
            <>
              <h1>WELCOME, CITIZEN.</h1>
              {otp.step === "phone" ? (
                <>
                  <p>Masukkan nomor WhatsApp member Anda — kode OTP dikirim ke sana.</p>
                  <div className="entry-form">
                    <input
                      className="entry-input interactive"
                      type="tel"
                      inputMode="tel"
                      autoComplete="tel"
                      placeholder="08xxxxxxxxxx"
                      value={otp.phone}
                      onChange={(e) => otp.setPhone(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && void otp.requestOtp()}
                    />
                    <button
                      className="enter-btn interactive"
                      disabled={otp.busy || !otp.phone.trim()}
                      onClick={() => void otp.requestOtp()}
                    >
                      {otp.busy ? "Mengirim…" : "Kirim Kode OTP"}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p>Kode 6 digit sudah dikirim ke WhatsApp {otp.phone}.</p>
                  <div className="entry-form">
                    <input
                      className="entry-input interactive"
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      placeholder="······"
                      value={otp.code}
                      onChange={(e) => otp.setCode(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && void otp.verifyOtp()}
                    />
                    <button
                      className="enter-btn interactive"
                      disabled={otp.busy || otp.code.trim().length !== 6}
                      onClick={() => void otp.verifyOtp()}
                    >
                      {otp.busy ? "Memeriksa…" : "Verifikasi"}
                    </button>
                  </div>
                  <div className="entry-alt">
                    <button onClick={otp.backToPhone}>
                      Ganti nomor / kirim ulang
                    </button>
                  </div>
                </>
              )}
              {otp.error && <div className="entry-error">{otp.error}</div>}
            </>
          ) : state.status === "error" ? (
            <>
              <h1>KONEKSI TERPUTUS.</h1>
              <p>Profil belum bisa dimuat. Coba lagi sebentar.</p>
              <div className="entry-line" />
              <button className="enter-btn interactive" onClick={reload}>
                Coba Lagi
              </button>
            </>
          ) : (
            <>
              <h1>MENYAMBUNGKAN…</h1>
              <p>Memuat profil Citizen Anda dari Wounderland.</p>
            </>
          )}
        </div>
      </div>

      <div className="cursor-dot" ref={cursorDotRef} />
      <div className="cursor-ring" ref={cursorRingRef} />
    </div>
  );
}

/** Ikon SVG nav — disalin dari prototipe (stroke mengikuti CSS .nav-item svg). */
const NAV_ICONS: Record<NoxMode, React.ReactNode> = {
  dashboard: (
    <svg viewBox="0 0 24 24">
      <path d="M4 10.5 12 4l8 6.5V20H14v-6h-4v6H4z" />
    </svg>
  ),
  profile: (
    <svg viewBox="0 0 24 24">
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20c.5-4 3-6 7-6s6.5 2 7 6" />
    </svg>
  ),
  coins: (
    <svg viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="8" />
      <path d="M15 8.5c-.8-.7-1.8-1-3-1-1.7 0-3 1-3 2.3 0 3.6 6.5 1.2 6.5 4.9 0 1.4-1.4 2.5-3.4 2.5-1.4 0-2.6-.4-3.5-1.2M12 6v12" />
    </svg>
  ),
  history: (
    <svg viewBox="0 0 24 24">
      <path d="M5 5v5h5M5.7 9.4A7 7 0 1 1 6 16" />
      <path d="M12 8v4l3 2" />
    </svg>
  ),
};
