"use client";

import { useMemo, useState } from "react";
import { Crown, History, ImageIcon, PlusCircle } from "lucide-react";
import { formatDate, formatDateTime, formatNumber } from "@/lib/format";
import type { CrmAvatar, CrmAvatarInventory, CrmMember } from "../types";
import {
  avatarStockLeft,
  buildAvatarActivity,
  findActiveAvatar,
  grantableAvatars,
  type AvatarActivityTone,
  type GrantSource,
} from "../member-detail";
import { useEquipAvatar, useGrantAvatar } from "../mutations";
import {
  EmptyBox,
  FeedbackNote,
  HistoryCard,
  NO_FEEDBACK,
  errorText,
  fieldClass,
  type Feedback,
} from "./member-detail-ui";

const TONE_DOT: Record<AvatarActivityTone, string> = {
  emerald: "bg-emerald-500",
  amber: "bg-amber-500",
  sky: "bg-sky-500",
  slate: "bg-slate-400",
};

/** Avatar aktif, koleksi + grant admin, dan riwayat avatar member. */
export function MemberAvatarSection({
  member,
  avatars,
  inventory,
  crmProfileReady,
}: {
  member: CrmMember;
  avatars: CrmAvatar[];
  inventory: CrmAvatarInventory[];
  crmProfileReady: boolean;
}) {
  const equipMutation = useEquipAvatar();
  const grantMutation = useGrantAvatar();
  const [selectedId, setSelectedId] = useState("");
  const [grantSource, setGrantSource] = useState<GrantSource>("manual");
  const [grantEquip, setGrantEquip] = useState(false);
  const [equipFeedback, setEquipFeedback] = useState<Feedback>(NO_FEEDBACK);
  const [grantFeedback, setGrantFeedback] = useState<Feedback>(NO_FEEDBACK);

  const activeAvatar = findActiveAvatar(member, inventory);
  const grantable = useMemo(() => grantableAvatars(avatars, inventory), [avatars, inventory]);
  const activity = useMemo(() => buildAvatarActivity(inventory), [inventory]);
  // Pilihan yang sudah tidak tersedia (mis. baru di-grant) jatuh ke avatar pertama.
  const selected = grantable.find((avatar) => avatar.id === selectedId) ?? grantable[0] ?? null;
  const stockLeft = avatarStockLeft(selected);
  const canGrant = Boolean(crmProfileReady && selected && (stockLeft === null || stockLeft > 0) && !grantMutation.isPending);

  async function equip(item: CrmAvatarInventory) {
    setEquipFeedback(NO_FEEDBACK);
    try {
      await equipMutation.mutateAsync({ memberId: member.id, inventoryId: item.id });
      setEquipFeedback({ error: null, success: `Avatar ${item.avatar?.name || "pilihan"} sekarang aktif` });
    } catch (err) {
      setEquipFeedback({ error: errorText(err, "Gagal memakai avatar"), success: null });
    }
  }

  async function grant() {
    if (!selected) return;
    setGrantFeedback(NO_FEEDBACK);
    try {
      await grantMutation.mutateAsync({
        member_id: member.id,
        avatar_id: selected.id,
        acquisition_source: grantSource,
        equip: grantEquip,
      });
      setGrantFeedback({ error: null, success: `Avatar ${selected.name} berhasil diberikan` });
    } catch (err) {
      setGrantFeedback({ error: errorText(err, "Gagal grant avatar"), success: null });
    }
  }

  return (
    <>
      <section className="grid gap-4 lg:grid-cols-[0.85fr_1.15fr]">
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <h3 className="flex items-center gap-2 text-base font-semibold text-slate-950">
              <Crown className="size-4" />
              Active Avatar
            </h3>
            <span className="rounded-md bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
              {formatNumber(inventory.length)} owned
            </span>
          </div>

          {activeAvatar?.avatar ? (
            <div className="mt-4 flex items-center gap-4 rounded-md border border-slate-200 bg-slate-50 p-3">
              {/* eslint-disable-next-line @next/next/no-img-element -- avatar URLs are admin-configured and can come from multiple providers */}
              <img
                src={activeAvatar.avatar.thumbnail_url || activeAvatar.avatar.image_url}
                alt={activeAvatar.avatar.name}
                className="size-20 rounded-md border border-slate-200 bg-white object-cover"
              />
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-slate-950">{activeAvatar.avatar.name}</div>
                <div className="mt-1 text-xs uppercase tracking-normal text-slate-500">{activeAvatar.avatar.rarity}</div>
                <div className="mt-2 text-xs text-slate-500">Dipakai sejak {formatDate(activeAvatar.acquired_at)}</div>
              </div>
            </div>
          ) : (
            <div className="mt-4">
              <EmptyBox>Belum ada avatar aktif.</EmptyBox>
            </div>
          )}
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-2 border-b border-slate-200 pb-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h3 className="flex items-center gap-2 text-base font-semibold text-slate-950">
                <ImageIcon className="size-4" />
                Avatar Collection
              </h3>
              <p className="mt-1 text-sm text-slate-500">Koleksi avatar member (grant admin/campaign/partner).</p>
            </div>
            <span className="rounded-md bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
              {formatNumber(member.lifetime_xp)} XP
            </span>
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
            <div className="space-y-3">
              <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                Redeem avatar dengan XP sudah dipensiunkan (EPIC-011): XP adalah skor seumur hidup dan tidak pernah
                berkurang.
              </div>
              <FeedbackNote feedback={equipFeedback} />

              <div className="rounded-md border border-slate-200 bg-white p-3 shadow-sm">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-semibold text-slate-950">Admin Grant</div>
                  <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-500">No XP</span>
                </div>
                <div className="mt-3 space-y-3">
                  <label className="block text-sm">
                    <span className="text-xs font-medium text-slate-500">Avatar</span>
                    <select
                      value={selected?.id ?? ""}
                      onChange={(event) => setSelectedId(event.target.value)}
                      disabled={grantable.length === 0 || grantMutation.isPending}
                      className={fieldClass}
                    >
                      {grantable.length === 0 ? (
                        <option value="">Tidak ada avatar tersedia</option>
                      ) : (
                        grantable.map((avatar) => (
                          <option key={avatar.id} value={avatar.id}>
                            {avatar.name}
                          </option>
                        ))
                      )}
                    </select>
                  </label>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block text-sm">
                      <span className="text-xs font-medium text-slate-500">Source</span>
                      <select
                        value={grantSource}
                        onChange={(event) => setGrantSource(event.target.value as GrantSource)}
                        disabled={grantMutation.isPending}
                        className={fieldClass}
                      >
                        <option value="manual">Manual</option>
                        <option value="campaign">Campaign</option>
                        <option value="partner">Partner</option>
                      </select>
                    </label>
                    <label className="flex h-10 items-center gap-2 self-end rounded-md border border-slate-300 px-3 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        checked={grantEquip}
                        onChange={(event) => setGrantEquip(event.target.checked)}
                        className="size-4 rounded border-slate-300"
                      />
                      Jadikan active
                    </label>
                  </div>

                  {stockLeft === 0 && (
                    <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                      Stok avatar sudah habis.
                    </div>
                  )}
                  <FeedbackNote feedback={grantFeedback} />

                  <button
                    type="button"
                    onClick={() => void grant()}
                    disabled={!canGrant}
                    className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-800 shadow-sm transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                  >
                    <PlusCircle className="size-4" />
                    {grantMutation.isPending ? "Granting..." : "Grant Avatar"}
                  </button>
                </div>
              </div>
            </div>

            <div>
              {inventory.length === 0 ? (
                <EmptyBox>Collection masih kosong.</EmptyBox>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {inventory.map((item) => (
                    <div key={item.id} className="rounded-md border border-slate-200 bg-slate-50 p-3">
                      <div className="flex gap-3">
                        {item.avatar ? (
                          /* eslint-disable-next-line @next/next/no-img-element -- avatar URLs are admin-configured and can come from multiple providers */
                          <img
                            src={item.avatar.thumbnail_url || item.avatar.image_url}
                            alt={item.avatar.name}
                            className="size-14 rounded-md border border-slate-200 bg-white object-cover"
                          />
                        ) : (
                          <div className="flex size-14 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-400">
                            <ImageIcon className="size-5" />
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-semibold text-slate-950">
                            {item.avatar?.name || "Avatar"}
                          </div>
                          <div className="mt-1 text-xs text-slate-500">
                            {item.avatar?.rarity || "collectible"} · {formatDate(item.acquired_at)}
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => void equip(item)}
                        disabled={item.is_equipped || equipMutation.isPending}
                        className="mt-3 inline-flex h-9 w-full items-center justify-center rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-100 disabled:cursor-default disabled:border-emerald-200 disabled:bg-emerald-50 disabled:text-emerald-700"
                      >
                        {item.is_equipped ? "Active" : "Use Avatar"}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      <HistoryCard
        icon={History}
        title="Avatar Activity"
        countLabel={`${formatNumber(activity.length)} records`}
        empty={activity.length === 0 ? "Belum ada aktivitas avatar." : null}
      >
        {activity.map((entry) => (
          <div key={entry.id} className="grid grid-cols-[auto_1fr_auto] gap-3 px-4 py-3">
            <div className={`mt-1 size-2.5 rounded-full ${TONE_DOT[entry.tone]}`} />
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-slate-900">{entry.title}</div>
              <div className="mt-1 truncate text-xs text-slate-500">{entry.detail}</div>
            </div>
            <div className="whitespace-nowrap text-xs text-slate-500">{formatDateTime(entry.date)}</div>
          </div>
        ))}
      </HistoryCard>
    </>
  );
}
