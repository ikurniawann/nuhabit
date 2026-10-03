"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
  BookMarked,
  Camera,
  ChevronRight,
  Footprints,
  HeartPulse,
  IdCard,
  LogOut,
  Settings,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { MemberCardSheet } from "../components/member-card";
import { memberApi } from "../lib/api";
import { useT } from "../lib/i18n";
import { initialsOf } from "../lib/initials";
import { m } from "../lib/links";
import { useAccount, useInvalidateAll } from "../lib/queries-home";
import { Spinner, StatusBadge, formatDay } from "../ui";

export function ProfilePage() {
  const t = useT();
  const router = useRouter();
  const qc = useQueryClient();
  const { data: me, isLoading } = useAccount();
  const invalidate = useInvalidateAll();
  const [editing, setEditing] = useState(false);
  const [cardOpen, setCardOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);

  if (isLoading || !me) return <Spinner label={t("Loading profile…")} />;
  const member = me.member;

  const startEdit = () => {
    setEmail(member.email);
    setEditing(true);
  };

  const save = async () => {
    setBusy(true);
    try {
      await memberApi("/profile", { method: "PUT", json: { email } });
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
              <label className="nh-label">{t("Email")}</label>
              <input className="nh-input" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div>
              <label className="nh-label">{t("Phone")}</label>
              <input className="nh-input opacity-60" value={member.phone} disabled />
              <p className="mt-1 text-xs text-nh-muted">
                {t("Phone is your sign-in number and cannot be changed here.")}
              </p>
            </div>
            <div className="flex gap-2">
              <button className="nh-btn-brand flex-1 !py-2" disabled={busy} onClick={() => void save()}>
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
        {[
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
        ].map(({ to, icon: Icon, title, hint }) => (
          <Link
            key={to}
            href={m(to)}
            className="flex items-center gap-3 rounded-xl px-2 py-2.5 active:bg-nh-raised"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-nh-ink-soft text-white">
              <Icon size={16} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-bold">{title}</span>
              <span className="block truncate text-xs text-nh-muted">{hint}</span>
            </span>
            <ChevronRight size={16} className="text-nh-muted" />
          </Link>
        ))}
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
