"use client";

import { ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { setLang, useLang } from "@/features/member-portal/mobile/mobile-i18n";
import type { MemberSettingsView } from "@/lib/member-app/home-views";
import { memberApi } from "../lib/api";
import { useT } from "../lib/i18n";
import { useInvalidateAll, useSettings } from "../lib/queries-home";
import { Spinner } from "../ui";

const optionClass = (active: boolean) =>
  `rounded-xl border px-3 py-2.5 text-sm font-black uppercase ${
    active ? "border-nh-forest bg-nh-forest/10 text-nh-forest" : "border-nh-line bg-nh-cream text-nh-muted"
  }`;

export function SettingsPage() {
  const t = useT();
  const router = useRouter();
  const lang = useLang();
  const invalidate = useInvalidateAll();
  const { data: settings, isLoading } = useSettings();

  if (isLoading || !settings) return <Spinner label={t("Loading settings…")} />;

  const update = async (patch: Partial<MemberSettingsView>) => {
    await memberApi("/app/home/settings", { method: "PATCH", json: patch });
    invalidate();
  };

  return (
    <div className="flex flex-col gap-5">
      <button onClick={() => router.back()} className="flex items-center gap-1 text-sm font-bold text-nh-muted">
        <ArrowLeft size={16} /> {t("Back")}
      </button>
      <h1 className="nh-display text-3xl">{t("Settings")}</h1>

      <div className="nh-card flex flex-col gap-4 text-sm">
        <div>
          <p className="nh-label">{t("Language / Bahasa")}</p>
          <div className="grid grid-cols-2 gap-2">
            {(["EN", "ID"] as const).map((code) => (
              <button
                key={code}
                onClick={() => {
                  // Bahasa berlaku per perangkat (portal member); disimpan juga di akun.
                  setLang(code === "EN" ? "en" : "id");
                  void update({ language: code });
                }}
                className={optionClass(lang === code.toLowerCase())}
              >
                {code === "EN" ? "English" : "Bahasa Indonesia"}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="nh-label">{t("Units")}</p>
          <div className="grid grid-cols-2 gap-2">
            {(["METRIC", "IMPERIAL"] as const).map((u) => (
              <button key={u} onClick={() => void update({ units: u })} className={optionClass(settings.units === u)}>
                {u === "METRIC" ? t("Kilometers") : t("Miles")}
              </button>
            ))}
          </div>
        </div>

        <label className="flex items-center justify-between font-bold">
          <span>
            {t("Booking reminders")}
            <span className="block text-xs font-medium text-nh-muted">
              {t("Get notified before a booked class starts")}
            </span>
          </span>
          <input
            type="checkbox"
            checked={settings.bookingReminders}
            onChange={(e) => void update({ bookingReminders: e.target.checked })}
            className="h-5 w-5 accent-[var(--color-nh-forest)]"
          />
        </label>
      </div>

      <div className="nh-card text-sm text-nh-muted">
        <p className="nh-label">{t("About")}</p>
        <p>{t("NüHabit member app. Units and reminders are saved to your account; language applies to this device.")}</p>
      </div>
    </div>
  );
}
