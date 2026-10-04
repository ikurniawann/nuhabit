"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
  Award,
  BookMarked,
  Camera,
  ChevronRight,
  Coins,
  Flag,
  Footprints,
  Gift,
  HeartPulse,
  IdCard,
  LogOut,
  MessageSquareText,
  PartyPopper,
  Receipt,
  ReceiptText,
  Settings,
  Sparkles,
  TicketPercent,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatNumber } from "@/lib/member-app/loyalty";
import { MemberCardSheet } from "../components/member-card";
import { memberApi } from "../lib/api";
import { useT } from "../lib/i18n";
import { initialsOf } from "../lib/initials";
import { m } from "../lib/links";
import { useAccount, useInvalidateAll } from "../lib/queries-home";
import { useLoyaltyMe } from "../lib/queries-loyalty";
import { Spinner, StatusBadge, formatDay } from "../ui";

export function ProfilePage() {
  const t = useT();
  const router = useRouter();
  const qc = useQueryClient();
  const { data: me, isLoading } = useAccount();
  const { data: loyalty } = useLoyaltyMe();
  const invalidate = useInvalidateAll();
  const [editing, setEditing] = useState(false);
  const [cardOpen, setCardOpen] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", birth_date: "", gender: "", city: "" });
  const [busy, setBusy] = useState(false);

  if (isLoading || !me) return <Spinner label={t("Loading profile…")} />;
  const member = me.member;

  const profile = loyalty?.profile;
  const setField = (key: keyof typeof form) => (value: string) => setForm((cur) => ({ ...cur, [key]: value }));
  const startEdit = () => {
    setForm({
      name: member.fullName,
      email: member.email,
      birth_date: profile?.birthDate?.slice(0, 10) ?? "",
      gender: profile?.gender ?? "",
      city: profile?.city ?? "",
    });
    setEditing(true);
  };

  const save = async () => {
    setBusy(true);
    try {
      await memberApi("/profile", { method: "PUT", json: { ...form, name: form.name.trim() } });
      invalidate();
      setEditing(false);
    } finally {
      setBusy(false);
    }
  };

  const uploadAvatar = async (file: File | undefined) => {
    if (!file) return;
    const body = new FormData();
    body.append("file", file);
    await memberApi("/profile/photo", { method: "POST", body });
    invalidate();
  };

  const logout = async () => {
    await memberApi("/logout", { method: "POST" }).catch(() => undefined);
    qc.clear();
    router.replace(m("/auth/login"));
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-4">
        <label className="relative cursor-pointer" title={t("Change photo")}>
          {member.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={member.avatarUrl} alt="" className="h-16 w-16 rounded-full object-cover" />
          ) : (
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-nh-ink-soft text-2xl font-black text-white">
              {initialsOf(member.fullName)}
            </div>
          )}
          <span className="absolute -right-0.5 -bottom-0.5 rounded-full border border-nh-line bg-nh-cream p-1">
            <Camera size={12} />
          </span>
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => void uploadAvatar(e.target.files?.[0])}
          />
        </label>
        <div>
          <h1 className="nh-display text-3xl font-black">{member.fullName}</h1>
          <StatusBadge status={member.status} />
        </div>
      </div>

      <section className="nh-card flex flex-col gap-3 text-sm">
        <p className="nh-label !mb-0">{t("Personal information")}</p>
        {editing ? (
          <>
            <div>
              <label className="nh-label">{t("Full name")}</label>
              <input
                className="nh-input"
                value={form.name}
                maxLength={100}
                onChange={(e) => setField("name")(e.target.value)}
              />
            </div>
            <div>
              <label className="nh-label">{t("Email")}</label>
              <input className="nh-input" value={form.email} onChange={(e) => setField("email")(e.target.value)} />
            </div>
            <div>
              <label className="nh-label">{t("Date of birth")}</label>
              <input
                className="nh-input"
                type="date"
                value={form.birth_date}
                onChange={(e) => setField("birth_date")(e.target.value)}
              />
            </div>
            <div>
              <label className="nh-label">{t("Gender")}</label>
              <div className="flex gap-2">
                {(
                  [
                    ["male", t("Male")],
                    ["female", t("Female")],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={form.gender === value}
                    onClick={() => setField("gender")(form.gender === value ? "" : value)}
                    className={`flex-1 rounded-xl border px-3 py-2.5 text-sm font-bold ${
                      form.gender === value
                        ? "border-nh-forest bg-nh-forest/10 text-nh-forest"
                        : "border-nh-line bg-nh-cream text-nh-muted"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="nh-label">{t("City")}</label>
              <input
                className="nh-input"
                value={form.city}
                maxLength={100}
                onChange={(e) => setField("city")(e.target.value)}
              />
            </div>
            <div>
              <label className="nh-label">{t("Phone")}</label>
              <input className="nh-input opacity-60" value={member.phone} disabled />
              <p className="mt-1 text-xs text-nh-muted">
                {t("Phone is your sign-in number and cannot be changed here.")}
              </p>
            </div>
            <div className="flex gap-2">
              <button
                className="nh-btn-brand flex-1 !py-2"
                disabled={busy || !form.name.trim()}
                onClick={() => void save()}
              >
                {t("Save")}
              </button>
              <button className="nh-btn-ghost flex-1 !py-2" onClick={() => setEditing(false)}>
                {t("Cancel")}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="flex justify-between">
              <span className="text-nh-muted">{t("Email")}</span>
              <span className="font-bold">{member.email || "-"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-nh-muted">{t("Phone")}</span>
              <span className="font-bold">{member.phone}</span>
            </div>
            {profile?.city ? (
              <div className="flex justify-between">
                <span className="text-nh-muted">{t("City")}</span>
                <span className="font-bold">{profile.city}</span>
              </div>
            ) : null}
            <div className="flex justify-between">
              <span className="text-nh-muted">{t("Member since")}</span>
              <span className="font-bold">{formatDay(member.createdAt)}</span>
            </div>
            <button className="nh-btn-ghost !py-2 text-sm" onClick={startEdit}>
              {t("Edit contact info")}
            </button>
          </>
        )}
      </section>

      <section className="nh-card flex flex-col !p-2 text-sm">
        <button
          onClick={() => setCardOpen(true)}
          className="flex items-center gap-3 rounded-xl px-2 py-2.5 text-left active:bg-nh-raised"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-nh-ink-soft text-white">
            <IdCard size={16} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-bold">{t("Digital member card")}</span>
            <span className="block truncate text-xs text-nh-muted">{t("Show it at the gate")}</span>
          </span>
          <ChevronRight size={16} className="text-nh-muted" />
        </button>
        <LinkRows
          items={[
            { to: "/wallet", icon: Wallet, title: t("Wallet & credits"), hint: t("Balance, top up, history") },
            { to: "/my-classes", icon: BookMarked, title: t("My classes"), hint: t("What your packages cover") },
            {
              to: "/profile/emergency",
              icon: HeartPulse,
              title: t("Emergency contact"),
              hint: member.emergencyContact
                ? `${member.emergencyContact.name} · ${member.emergencyContact.phone}`
                : t("Not set - add one"),
            },
            { to: "/profile/gear", icon: Footprints, title: t("My gear"), hint: t("Shoes & bike mileage") },
            { to: "/profile/settings", icon: Settings, title: t("Settings"), hint: t("Units, reminders") },
          ]}
        />
      </section>

      <section className="nh-card flex flex-col !p-2 text-sm">
        <p className="nh-label !mb-0 px-2 pt-2">{t("Member")}</p>
        <LinkRows
          items={[
            {
              to: "/coins",
              icon: Coins,
              title: "ARK Coin",
              hint: loyalty
                ? t("{n} ARK · top up, history", { n: formatNumber(loyalty.coins) })
                : t("Balance, top up, history"),
            },
            {
              to: "/rewards",
              icon: Gift,
              title: t("Rewards"),
              hint: loyalty
                ? `${formatNumber(loyalty.totalXp)} XP · ${loyalty.tier?.name ?? "Member"}`
                : t("Trade XP for rewards"),
            },
            { to: "/badges", icon: Award, title: t("Badges"), hint: t("Your achievements") },
            { to: "/collection", icon: Sparkles, title: t("Collection"), hint: t("Artwork & wallpapers") },
            { to: "/events", icon: PartyPopper, title: t("Events"), hint: t("Race days, workshops, meetups") },
            { to: "/challenges", icon: Flag, title: t("Challenges"), hint: t("Visit and spend goals") },
            { to: "/promos", icon: TicketPercent, title: t("Promos"), hint: t("Promo codes for members") },
            { to: "/reviews", icon: MessageSquareText, title: t("Reviews"), hint: t("Rate your orders") },
            { to: "/orders", icon: ReceiptText, title: t("Orders"), hint: t("Receipts and outlet visits") },
            { to: "/bills", icon: Receipt, title: t("Member bill"), hint: t("Unpaid orders on your tab") },
          ]}
        />
      </section>

      <section className="nh-card flex flex-col gap-2 text-sm">
        <p className="nh-label !mb-0">{t("Digital waiver")}</p>
        <div className="flex justify-between">
          <span className="text-nh-muted">{t("Version {v}", { v: member.waiverVersion ?? "-" })}</span>
          <span className="font-bold text-nh-ok">
            {member.waiverAcceptedAt
              ? t("Signed {date}", { date: formatDay(member.waiverAcceptedAt) })
              : t("Not signed")}
          </span>
        </div>
      </section>

      <button
        onClick={() => void logout()}
        className="nh-btn-ghost flex items-center justify-center gap-2 text-nh-danger"
      >
        <LogOut size={16} /> {t("Sign out")}
      </button>

      {cardOpen ? <MemberCardSheet onClose={() => setCardOpen(false)} /> : null}
    </div>
  );
}

/** Baris tautan akun: ikon bulat gelap, judul, petunjuk, chevron. */
function LinkRows({ items }: { items: Array<{ to: string; icon: LucideIcon; title: string; hint: string }> }) {
  return items.map(({ to, icon: Icon, title, hint }) => (
    <Link key={to} href={m(to)} className="flex items-center gap-3 rounded-xl px-2 py-2.5 active:bg-nh-raised">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-nh-ink-soft text-white">
        <Icon size={16} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-bold">{title}</span>
        <span className="block truncate text-xs text-nh-muted">{hint}</span>
      </span>
      <ChevronRight size={16} className="text-nh-muted" />
    </Link>
  ));
}
