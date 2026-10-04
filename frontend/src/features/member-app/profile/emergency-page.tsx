"use client";

import { ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { EmergencyContact } from "@/lib/member-app/home-views";
import { ApiError, memberApi } from "../lib/api";
import { useT } from "../lib/i18n";
import { useAccount, useInvalidateAll } from "../lib/queries-home";
import { Spinner } from "../ui";

export function EmergencyContactPage() {
  const t = useT();
  const { data: me } = useAccount();
  if (!me) return <Spinner label={t("Loading profile…")} />;
  return <EmergencyContactForm contact={me.member.emergencyContact} />;
}

/** Form terpisah supaya isian awal diambil dari akun yang sudah termuat. */
function EmergencyContactForm({ contact }: { contact: EmergencyContact | null }) {
  const t = useT();
  const router = useRouter();
  const invalidate = useInvalidateAll();
  const [name, setName] = useState(contact?.name ?? "");
  const [phone, setPhone] = useState(contact?.phone ?? "");
  const [relation, setRelation] = useState(contact?.relation ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    setBusy(true);
    setError("");
    try {
      await memberApi("/app/home/me", {
        method: "PATCH",
        json: { emergencyContact: name && phone ? { name, phone, relation: relation || "Contact" } : null },
      });
      invalidate();
      router.back();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("Save failed."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <button onClick={() => router.back()} className="flex items-center gap-1 text-sm font-bold text-nh-muted">
        <ArrowLeft size={16} /> {t("Back")}
      </button>
      <h1 className="nh-display text-3xl">{t("Emergency contact")}</h1>
      <p className="-mt-2 text-sm text-nh-muted">{t("Shown to studio staff if something happens during training.")}</p>
      <div>
        <label className="nh-label">{t("Contact name")}</label>
        <input className="nh-input" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div>
        <label className="nh-label">{t("Contact phone")}</label>
        <input className="nh-input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+62812…" />
      </div>
      <div>
        <label className="nh-label">{t("Relationship")}</label>
        <input
          className="nh-input"
          value={relation}
          onChange={(e) => setRelation(e.target.value)}
          placeholder={t("Spouse, parent…")}
        />
      </div>
      {error ? <p className="text-sm font-bold text-nh-danger">{error}</p> : null}
      <button className="nh-btn-brand" disabled={busy || !name || phone.length < 6} onClick={() => void save()}>
        {t("Save contact")}
      </button>
    </div>
  );
}
