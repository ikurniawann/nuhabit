"use client";

import { useRef, useState, type ReactNode } from "react";
import {
  Award,
  Camera,
  ChevronRight,
  Gift,
  IdCard,
  Languages,
  LogOut,
  MapPin,
  Megaphone,
  MessageSquareText,
  Pencil,
  Smartphone,
  Sparkles,
  TicketPercent,
  type LucideIcon,
} from "lucide-react";
import { angka } from "../format";
import type { NoxMemberData } from "../nox/use-nox-member";
import { memberApi, postJson } from "./mobile-api";
import { setLang, useLang, useLocale, useT } from "./mobile-i18n";
import { useMemberPush } from "./mobile-pwa";
import { BottomSheet } from "./mobile-sheets";
import type { MobileSheet, MobileTab } from "./mobile-screens";
import { ErrorNote, OkNote, Toggle } from "./mobile-ui";

function initials(name: string | null): string {
  return (
    (name ?? "M")
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase() || "M"
  );
}

/** Foto profil bulat, atau inisial bila belum ada foto. */
export function MemberAvatar({ member, className }: { member: NoxMemberData; className: string }) {
  const { name, photoUrl } = member.profile;
  return photoUrl ? (
    // eslint-disable-next-line @next/next/no-img-element -- foto unggahan member (/api/files)
    <img src={photoUrl} alt="" className={`${className} object-cover`} />
  ) : (
    <span className={`${className} flex items-center justify-center bg-nh-ink-soft font-black text-white`}>
      {initials(name)}
    </span>
  );
}

function PhotoButton({ member, onChanged }: { member: NoxMemberData; onChanged: () => void }) {
  const t = useT();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      await memberApi("/api/member-portal/profile/photo", { method: "POST", body: form });
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Gagal mengunggah foto"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative shrink-0">
      <MemberAvatar member={member} className="size-20 rounded-full text-2xl" />
      <button
        type="button"
        onClick={() => input.current?.click()}
        disabled={busy}
        aria-label={t("Ganti foto profil")}
        className="nh-surface-brand absolute -right-1 -bottom-1 flex size-8 items-center justify-center rounded-full text-nh-ink ring-4 ring-nh-beige disabled:opacity-60"
      >
        {busy ? <span className="size-3.5 animate-spin rounded-full border-2 border-nh-ink/20 border-t-nh-ink" /> : <Camera size={15} />}
      </button>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void upload(file);
        }}
      />
      {error && <p className="absolute top-full left-0 mt-2 w-48 text-xs text-nh-danger">{error}</p>}
    </div>
  );
}

function EditContactSheet({
  member,
  onClose,
  onSaved,
}: {
  member: NoxMemberData;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useT();
  const p = member.profile;
  const [form, setForm] = useState({
    name: p.name ?? "",
    email: p.email ?? "",
    birth_date: p.birthDate ? p.birthDate.slice(0, 10) : "",
    gender: p.gender ?? "",
    city: p.city ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (key: keyof typeof form) => (value: string) => setForm((cur) => ({ ...cur, [key]: value }));

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await postJson("/api/member-portal/profile", { ...form, name: form.name.trim() }, "PUT");
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Gagal menyimpan profil"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet kicker={t("Profil")} title={t("Ubah data diri")} onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <label>
          <span className="nh-label">{t("Nama lengkap")}</span>
          <input className="nh-input" value={form.name} onChange={(e) => set("name")(e.target.value)} maxLength={100} />
        </label>
        <label>
          <span className="nh-label">Email</span>
          <input
            className="nh-input"
            type="email"
            value={form.email}
            onChange={(e) => set("email")(e.target.value)}
            maxLength={100}
          />
        </label>
        <label>
          <span className="nh-label">{t("Tanggal lahir")}</span>
          <input className="nh-input" type="date" value={form.birth_date} onChange={(e) => set("birth_date")(e.target.value)} />
        </label>
        <div>
          <span className="nh-label">{t("Jenis kelamin")}</span>
          <div className="flex gap-2">
            {(
              [
                ["male", t("Laki-laki")],
                ["female", t("Perempuan")],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={form.gender === value}
                onClick={() => set("gender")(form.gender === value ? "" : value)}
                className={`flex-1 rounded-2xl border px-3 py-3 text-sm font-bold ${
                  form.gender === value ? "border-nh-forest bg-nh-forest/10 text-nh-forest" : "border-nh-line text-nh-muted"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <label>
          <span className="nh-label">{t("Kota")}</span>
          <input className="nh-input" value={form.city} onChange={(e) => set("city")(e.target.value)} maxLength={100} />
        </label>
        <p className="text-xs text-nh-muted">
          {t("Nomor WhatsApp ({phone}) dipakai untuk masuk. Untuk menggantinya, hubungi kasir.", {
            phone: p.phone ?? "—",
          })}
        </p>
        {error && <ErrorNote>{error}</ErrorNote>}
        <button type="submit" className="nh-btn-brand w-full" disabled={busy || form.name.trim().length < 1}>
          {busy ? t("Menyimpan…") : t("Simpan")}
        </button>
      </form>
    </BottomSheet>
  );
}

function PreferenceRow({ icon: Icon, title, hint, control }: { icon: LucideIcon; title: string; hint: string; control: ReactNode }) {
  return (
    <div className="flex items-center gap-3 px-2 py-2.5">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-nh-ink-soft text-white">
        <Icon size={16} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-bold">{title}</span>
        <span className="block text-xs text-nh-muted">{hint}</span>
      </span>
      {control}
    </div>
  );
}

function Preferences({ member, onChanged }: { member: NoxMemberData; onChanged: () => void }) {
  const t = useT();
  const lang = useLang();
  const push = useMemberPush();
  const [marketing, setMarketing] = useState(member.marketingOptIn);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const changeMarketing = async (enabled: boolean) => {
    setSaving(true);
    setMessage(null);
    setMarketing(enabled);
    try {
      const data = await postJson<{ marketing_opt_in: boolean }>("/api/member-portal/consent", { enabled }, "PUT");
      setMarketing(data.marketing_opt_in);
      setMessage({
        ok: true,
        text: data.marketing_opt_in ? t("Promo WhatsApp dinyalakan.") : t("Anda tidak akan menerima promo WhatsApp lagi."),
      });
      onChanged();
    } catch (err) {
      setMarketing(!enabled);
      setMessage({ ok: false, text: err instanceof Error ? err.message : t("Gagal menyimpan pilihan promo") });
    } finally {
      setSaving(false);
    }
  };

  const pushHint: Record<typeof push.state, string> = {
    on: t("Aktif di perangkat ini"),
    off: t("Kabar event, promo, dan saldo langsung ke HP"),
    denied: t("Diblokir di pengaturan browser"),
    unsupported: t("Browser ini belum mendukung notifikasi"),
    unconfigured: t("Belum tersedia"),
  };

  return (
    <section className="nh-card flex flex-col !p-2 text-sm">
      <p className="nh-label !mb-0 px-2 pt-2">{t("Pengaturan")}</p>
      <PreferenceRow
        icon={Megaphone}
        title={t("Promo lewat WhatsApp")}
        hint={marketing ? t("Anda menerima promo dan kabar terbaru") : t("Promo WhatsApp dimatikan")}
        control={
          <Toggle
            checked={marketing}
            disabled={saving}
            onChange={(next) => void changeMarketing(next)}
            label={t("Promo lewat WhatsApp")}
          />
        }
      />
      <PreferenceRow
        icon={Smartphone}
        title={t("Notifikasi di HP")}
        hint={pushHint[push.state]}
        control={
          <Toggle
            checked={push.state === "on"}
            disabled={push.busy || push.state === "unsupported" || push.state === "unconfigured" || push.state === "denied"}
            onChange={(next) => void (next ? push.enable() : push.disable())}
            label={t("Notifikasi di HP")}
          />
        }
      />
      <PreferenceRow
        icon={Languages}
        title={t("Bahasa")}
        hint={lang === "id" ? "Bahasa Indonesia" : "English"}
        control={
          <div className="inline-flex rounded-full bg-nh-raised p-1" role="radiogroup" aria-label={t("Bahasa")}>
            {(["id", "en"] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={lang === value}
                onClick={() => setLang(value)}
                className={`rounded-full px-3 py-1 text-xs font-black ${lang === value ? "bg-nh-ink text-white" : "text-nh-ink/60"}`}
              >
                {value.toUpperCase()}
              </button>
            ))}
          </div>
        }
      />
      {(message || push.error) && (
        <div className="px-2 pb-2">
          {push.error && <ErrorNote>{push.error}</ErrorNote>}
          {message && (message.ok ? <OkNote>{message.text}</OkNote> : <ErrorNote>{message.text}</ErrorNote>)}
        </div>
      )}
    </section>
  );
}

export function ProfileScreen({
  member,
  openSheet,
  goTab,
  onLogout,
  onChanged,
}: {
  member: NoxMemberData;
  openSheet: (sheet: MobileSheet) => void;
  goTab: (tab: MobileTab) => void;
  onLogout: () => void;
  /** Muat ulang data member setelah profil berubah. */
  onChanged: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const [editing, setEditing] = useState(false);
  const p = member.profile;
  const genderLabel = p.gender === "male" ? t("Laki-laki") : p.gender === "female" ? t("Perempuan") : null;
  const rows: Array<[string, string | null]> = [
    [t("Telepon"), p.phone],
    ["Email", p.email],
    [t("Tanggal lahir"), p.birthDate ? new Date(p.birthDate).toLocaleDateString(locale, { dateStyle: "long" }) : null],
    [t("Jenis kelamin"), genderLabel],
    [t("Kota"), p.city],
    [t("Tipe member"), member.memberType === "card" ? t("Kartu") : t("Terdaftar")],
  ];
  const menu: Array<{ icon: LucideIcon; title: string; hint: string; onClick: () => void }> = [
    { icon: IdCard, title: t("Kartu member digital"), hint: t("Tunjukkan di kasir"), onClick: () => openSheet({ type: "card" }) },
    {
      icon: Sparkles,
      title: t("Tier & XP"),
      hint: `${angka(member.totalXp)} XP · ${member.tier?.name ?? "Member"}`,
      onClick: () => openSheet({ type: "tier" }),
    },
    { icon: Gift, title: t("Reward"), hint: t("Tukar XP dengan hadiah"), onClick: () => goTab("rewards") },
    { icon: Award, title: t("Badge"), hint: t("Pencapaian Anda"), onClick: () => goTab("badges") },
    { icon: Sparkles, title: t("Koleksi"), hint: t("Artwork & wallpaper"), onClick: () => goTab("collection") },
    { icon: TicketPercent, title: t("Promo"), hint: t("Kode promo untuk member"), onClick: () => goTab("promos") },
    { icon: MessageSquareText, title: t("Ulasan"), hint: t("Nilai pesanan Anda"), onClick: () => goTab("reviews") },
    {
      icon: MapPin,
      title: t("Kunjungan"),
      hint: t("{n} kunjungan tercatat", { n: angka(member.visitCount) }),
      onClick: () => openSheet({ type: "visits" }),
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-4">
        <PhotoButton member={member} onChanged={onChanged} />
        <div className="min-w-0">
          <h1 className="nh-display truncate text-3xl font-black">{p.name ?? "Member"}</h1>
          {member.tier && <span className="nh-chip mt-1 bg-nh-forest/10 text-nh-forest">{member.tier.name}</span>}
        </div>
      </div>

      <section className="nh-card flex flex-col gap-3 text-sm">
        <div className="flex items-center justify-between">
          <p className="nh-label !mb-0">{t("Data pribadi")}</p>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="inline-flex items-center gap-1 text-xs font-bold text-nh-forest"
          >
            <Pencil size={13} /> {t("Ubah")}
          </button>
        </div>
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-3">
            <span className="text-nh-muted">{label}</span>
            <span className="truncate text-right font-bold">{value ?? "—"}</span>
          </div>
        ))}
      </section>

      <Preferences member={member} onChanged={onChanged} />

      <section className="nh-card flex flex-col !p-2 text-sm">
        {menu.map(({ icon: Icon, title, hint, onClick }) => (
          <button
            key={title}
            type="button"
            onClick={onClick}
            className="flex items-center gap-3 rounded-xl px-2 py-2.5 text-left active:bg-nh-raised"
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-nh-ink-soft text-white">
              <Icon size={16} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-bold">{title}</span>
              <span className="block truncate text-xs text-nh-muted">{hint}</span>
            </span>
            <ChevronRight size={16} className="text-nh-muted" />
          </button>
        ))}
      </section>

      <button type="button" onClick={onLogout} className="nh-btn-ghost w-full text-nh-danger">
        <LogOut size={16} /> {t("Keluar")}
      </button>

      {editing && <EditContactSheet member={member} onClose={() => setEditing(false)} onSaved={onChanged} />}
    </div>
  );
}
