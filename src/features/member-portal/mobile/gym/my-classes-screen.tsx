"use client";

import { useState } from "react";
import { hariJam } from "../../format";
import { useLocale, useT } from "../mobile-i18n";
import { EmptyCard, ErrorNote, LoadingNote } from "../mobile-ui";
import { ClassSheet } from "./class-sheet";
import { useMyClasses, type MyClass } from "./gym-classes-api";

const PAST_LABEL: Partial<Record<MyClass["status"], string>> = {
  completed: "Hadir",
  checked_in: "Hadir",
  no_show: "Tidak hadir",
  cancelled: "Dibatalkan",
  confirmed: "Terdaftar",
  waitlist: "Waitlist",
};

/**
 * Kelas saya: tab mendatang (buka lembar untuk batal / ambil kursi tawaran)
 * dan riwayat. `onFindClass` (opsional) membuka jadwal kelas dari kartu kosong.
 */
export function MyClassesScreen({ onFindClass }: { onFindClass?: () => void }) {
  const t = useT();
  const locale = useLocale();
  const [scope, setScope] = useState<"upcoming" | "past">("upcoming");
  const [openId, setOpenId] = useState<string | null>(null);
  const { data, isLoading, error } = useMyClasses(scope);

  return (
    <div className="flex flex-col gap-5">
      <h1 className="nh-display text-3xl font-black">{t("Kelas saya")}</h1>
      <div className="flex gap-2" role="tablist">
        {(["upcoming", "past"] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={scope === value}
            onClick={() => setScope(value)}
            className={`nh-chip ${scope === value ? "bg-nh-ink text-white" : "bg-nh-raised text-nh-muted"}`}
          >
            {value === "upcoming" ? t("Mendatang") : t("Riwayat")}
          </button>
        ))}
      </div>

      {isLoading && <LoadingNote />}
      {error && <ErrorNote>{error.message}</ErrorNote>}
      {data && data.length === 0 && (
        <EmptyCard>
          {scope === "upcoming" ? t("Belum ada kelas yang di-booking.") : t("Belum ada riwayat kelas.")}
          {scope === "upcoming" && onFindClass && (
            <button type="button" className="nh-btn-brand mt-3 w-full" onClick={onFindClass}>
              {t("Cari kelas")}
            </button>
          )}
        </EmptyCard>
      )}
      {data?.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => scope === "upcoming" && setOpenId(item.session_id)}
          className="nh-card block w-full text-left active:scale-[0.99]"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-bold tracking-[0.18em] text-nh-muted uppercase">{hariJam(item.starts_at, locale)}</p>
              <p className="nh-display mt-1 text-xl leading-tight">{item.class_type_name}</p>
              <p className="mt-1 text-xs text-nh-muted">
                {[item.coach_name, item.area, t("{n} kredit", { n: item.credit_cost })].filter(Boolean).join(" · ")}
              </p>
            </div>
            <span
              className={`nh-chip shrink-0 ${
                item.status === "confirmed" || item.status === "checked_in" || item.status === "completed"
                  ? "bg-nh-lime text-nh-ink"
                  : "bg-nh-raised text-nh-muted"
              }`}
            >
              {item.status === "waitlist"
                ? item.promotion_offered_at
                  ? t("Kursi ditawarkan")
                  : t("Waitlist #{n}", { n: item.waitlist_position ?? "" })
                : t(PAST_LABEL[item.status] ?? item.status)}
            </span>
          </div>
          {item.late_cancel && <p className="mt-2 text-xs text-nh-danger">{t("Batal terlambat")}</p>}
          {item.cancel_info?.late && (
            <p className="mt-2 text-xs text-nh-danger">
              {item.cancel_info.penalty_credits
                ? t("Batas batal gratis lewat: batal sekarang {n} kredit hangus.", { n: item.cancel_info.penalty_credits })
                : t("Batas batal gratis sudah lewat.")}
            </p>
          )}
        </button>
      ))}
      {openId && <ClassSheet sessionId={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}
