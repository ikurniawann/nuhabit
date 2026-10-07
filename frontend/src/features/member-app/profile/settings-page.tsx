"use client";

import { ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { setLang, useLang } from "../lib/lang";
import type { MemberSettingsView } from "@/lib/member-app/home-views";
import { useMemberPush } from "../components/pwa";
import { memberApi } from "../lib/api";
import { useT } from "../lib/i18n";
import { useInvalidateAll, useSettings } from "../lib/queries-home";
import { loyaltyKeys, useLoyaltyMe, useRefresh } from "../lib/queries-loyalty";
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

      <NotificationSettings />

      <div className="nh-card text-sm text-nh-muted">
        <p className="nh-label">{t("About")}</p>
        <p>{t("NüHabit member app. Units and reminders are saved to your account; language applies to this device.")}</p>
      </div>
    </div>
  );
}

/** Web push di perangkat ini dan persetujuan promo WhatsApp (dulu di profil portal lama). */
function NotificationSettings() {
  const t = useT();
  const push = useMemberPush();
  const refresh = useRefresh();
  const { data: me } = useLoyaltyMe();
  const [saving, setSaving] = useState(false);
  const [consentError, setConsentError] = useState("");

  const pushHint: Record<typeof push.state, string> = {
    on: t("On for this device"),
    off: t("Events, promos, and balance updates straight to your phone"),
    denied: t("Blocked in your browser settings"),
    unsupported: t("This browser does not support notifications yet"),
    unconfigured: t("Not available yet"),
  };
  const pushLocked =
    push.busy || push.state === "unsupported" || push.state === "unconfigured" || push.state === "denied";

  const changeMarketing = async (enabled: boolean) => {
    setSaving(true);
    setConsentError("");
    try {
      await memberApi("/consent", { method: "PUT", json: { enabled } });
      await refresh(loyaltyKeys.me);
    } catch (e) {
      setConsentError(e instanceof Error ? e.message : t("Request failed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="nh-card flex flex-col gap-4 text-sm">
      <p className="nh-label !mb-0">{t("Notifications")}</p>
      <label className="flex items-center justify-between gap-3 font-bold">
        <span>
          {t("Phone notifications")}
          <span className="block text-xs font-medium text-nh-muted">{pushHint[push.state]}</span>
        </span>
        <input
          type="checkbox"
          checked={push.state === "on"}
          disabled={pushLocked}
          onChange={(e) => void (e.target.checked ? push.enable() : push.disable())}
          className="h-5 w-5 shrink-0 accent-[var(--color-nh-forest)]"
        />
      </label>
      <label className="flex items-center justify-between gap-3 font-bold">
        <span>
          {t("Promos on WhatsApp")}
          <span className="block text-xs font-medium text-nh-muted">
            {me?.marketingOptIn ? t("You get promos and news") : t("WhatsApp promos are off")}
          </span>
        </span>
        <input
          type="checkbox"
          checked={me?.marketingOptIn ?? false}
          disabled={!me || saving}
          onChange={(e) => void changeMarketing(e.target.checked)}
          className="h-5 w-5 shrink-0 accent-[var(--color-nh-forest)]"
        />
      </label>
      {push.error ? <p className="text-xs font-semibold text-nh-danger">{t(push.error)}</p> : null}
      {consentError ? <p className="text-xs font-semibold text-nh-danger">{consentError}</p> : null}
    </div>
  );
}
