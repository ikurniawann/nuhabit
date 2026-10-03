"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { RecordTimeline } from "@/features/sales-funnel/timeline";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  CalendarClock,
  Coins,
  Crown,
  Gift,
  History,
  ImageIcon,
  PlusCircle,
  ReceiptText,
  RefreshCw,
  Save,
  ShieldCheck,
  Sparkles,
  TicketCheck,
  UserPlus,
  UserRound,
} from "lucide-react";
import type { CrmAvatarInventory, CrmMember } from "../types";
import { useMemberDetail } from "../queries";
import { MemberEngagementPanel } from "./member-engagement-panel";
import {
  useEnrollMember,
  useEquipAvatar,
  useGrantAvatar,
  useUpdateMember,
} from "../mutations";

type AvatarActivity = {
  id: string;
  title: string;
  detail: string;
  date: string;
  tone: "emerald" | "amber" | "sky" | "slate";
};

type EditForm = {
  name: string;
  phone: string;
  email: string;
  tierId: string;
  status: string;
  customerActive: boolean;
  /** EPIC-043 — KOL: komplimen gratis otomatis di kasir + kuota bulanan. */
  isKol: boolean;
  kolLimit: string;
};

const numberFormat = new Intl.NumberFormat("id-ID");
const currencyFormat = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});

function formatNumber(value: number) {
  return numberFormat.format(value || 0);
}

function formatCurrency(value: number) {
  return currencyFormat.format(value || 0);
}

function formatDate(value?: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function formatDateTime(value?: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function tierName(member: CrmMember) {
  return member.tier?.name || member.customer?.membership_tier || "Regular";
}

function avatarSourceLabel(source: string) {
  const labels: Record<string, string> = {
    redemption: "XP redemption",
    manual: "Manual grant",
    campaign: "Campaign grant",
    partner: "Partner grant",
    migration: "Migration",
  };

  return labels[source] ?? source;
}

export function CrmMemberDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const memberId = params.id;

  const { data, isLoading, isFetching, error, refetch } = useMemberDetail(memberId);
  const equipAvatarMutation = useEquipAvatar();
  const grantAvatarMutation = useGrantAvatar();
  const enrollMutation = useEnrollMember();
  const updateMemberMutation = useUpdateMember();

  const loading = isLoading || isFetching;
  const errorMessage = error instanceof Error ? error.message : null;

  const member = data?.member ?? null;
  const xpLedger = data?.xpLedger ?? [];
  const recentOrders = data?.recentOrders ?? [];
  const redemptions = data?.redemptions ?? [];
  const tiers = data?.tiers ?? [];
  const avatars = data?.avatars ?? [];
  const avatarInventory = data?.avatarInventory ?? [];

  const [selectedGrantAvatarId, setSelectedGrantAvatarId] = useState("");
  const [grantSource, setGrantSource] = useState<"manual" | "campaign" | "partner">("manual");
  const [grantEquip, setGrantEquip] = useState(false);
  const [avatarStatus, setAvatarStatus] = useState<{ loading: boolean; error: string | null; success: string | null }>({
    loading: false,
    error: null,
    success: null,
  });
  const [grantStatus, setGrantStatus] = useState<{ loading: boolean; error: string | null; success: string | null }>({
    loading: false,
    error: null,
    success: null,
  });
  const [enrollStatus, setEnrollStatus] = useState<{ loading: boolean; error: string | null }>({
    loading: false,
    error: null,
  });
  const [editForm, setEditForm] = useState<EditForm>({
    name: "",
    phone: "",
    email: "",
    tierId: "",
    status: "active",
    customerActive: true,
    isKol: false,
    kolLimit: "",
  });
  const [saveStatus, setSaveStatus] = useState<{ loading: boolean; error: string | null; success: string | null }>({
    loading: false,
    error: null,
    success: null,
  });

  const crmProfileReady = Boolean(member && !member.id.startsWith("pos-"));
  const activeTiers = useMemo(
    () => tiers.filter((tier) => tier.is_active !== false),
    [tiers]
  );
  const ownedAvatarIds = useMemo(
    () => new Set(avatarInventory.map((item) => item.avatar_id)),
    [avatarInventory]
  );
  const activeAvatar = useMemo(() => {
    if (!member) return null;
    return avatarInventory.find((item) => item.is_equipped)
      ?? avatarInventory.find((item) => item.avatar_id === member.active_avatar_id)
      ?? null;
  }, [member, avatarInventory]);
  const grantableAvatars = useMemo(() => {
    return avatars
      .filter((avatar) => avatar.is_active && !ownedAvatarIds.has(avatar.id))
      .sort((first, second) => first.name.localeCompare(second.name));
  }, [ownedAvatarIds, avatars]);
  const selectedGrantAvatar = grantableAvatars.find((avatar) => avatar.id === selectedGrantAvatarId) ?? grantableAvatars[0] ?? null;
  const selectedGrantStockLeft = selectedGrantAvatar?.stock_total === null || selectedGrantAvatar?.stock_total === undefined
    ? null
    : Math.max(0, selectedGrantAvatar.stock_total - selectedGrantAvatar.stock_redeemed);
  const avatarActivity = useMemo<AvatarActivity[]>(() => {
    const acquired = avatarInventory.map((inventory) => {
      const source = avatarSourceLabel(inventory.acquisition_source);
      const xpCost = inventory.metadata?.xp_cost ? ` · ${formatNumber(inventory.metadata.xp_cost)} XP` : "";
      const note = inventory.metadata?.note ? ` · ${inventory.metadata.note}` : "";
      const tone = inventory.acquisition_source === "redemption"
        ? "emerald"
        : inventory.acquisition_source === "campaign"
          ? "amber"
          : inventory.acquisition_source === "partner"
            ? "sky"
            : "slate";

      return {
        id: `acquired-${inventory.id}`,
        title: `${source}: ${inventory.avatar?.name || "Avatar"}`,
        detail: `${inventory.avatar?.rarity || "collectible"}${xpCost}${note}`,
        date: inventory.acquired_at,
        tone,
      } satisfies AvatarActivity;
    });

    const active = avatarInventory
      .filter((inventory) => inventory.is_equipped)
      .map((inventory) => ({
        id: `active-${inventory.id}`,
        title: `Active avatar: ${inventory.avatar?.name || "Avatar"}`,
        detail: "Avatar yang sedang dipakai member",
        date: inventory.acquired_at,
        tone: "sky" as const,
      }));

    return [...active, ...acquired]
      .sort((first, second) => new Date(second.date).getTime() - new Date(first.date).getTime())
      .slice(0, 12);
  }, [avatarInventory]);
  const canGrantAvatar = Boolean(
    member
      && crmProfileReady
      && selectedGrantAvatar
      && (selectedGrantStockLeft === null || selectedGrantStockLeft > 0)
      && !grantAvatarMutation.isPending
  );

  const summary = useMemo(() => {
    if (!member) return null;

    const nextXp = member.tier?.min_lifetime_xp ? Math.max(0, member.tier.min_lifetime_xp - member.lifetime_xp) : 0;
    return {
      nextXp,
      xpEarned: xpLedger.filter((row) => row.xp_delta > 0).reduce((sum, row) => sum + row.xp_delta, 0),
      xpSpent: xpLedger.filter((row) => row.xp_delta < 0).reduce((sum, row) => sum + Math.abs(row.xp_delta), 0),
    };
  }, [member, xpLedger]);

  useEffect(() => {
    if ((!selectedGrantAvatarId || !grantableAvatars.some((avatar) => avatar.id === selectedGrantAvatarId)) && grantableAvatars.length > 0) {
      setSelectedGrantAvatarId(grantableAvatars[0].id);
    }
  }, [grantableAvatars, selectedGrantAvatarId]);

  useEffect(() => {
    if (!member) return;
    setEditForm({
      name: member.customer?.name ?? "",
      phone: member.customer?.phone ?? "",
      email: member.customer?.email ?? "",
      tierId: activeTiers.find((tier) => tier.code === member.tier?.code)?.id ?? "",
      status: member.status || "active",
      customerActive: member.customer?.is_active !== false,
      isKol: member.customer?.is_kol === true,
      kolLimit:
        member.customer?.kol_monthly_limit_idr != null
          ? String(member.customer.kol_monthly_limit_idr)
          : "",
    });
  }, [activeTiers, member]);

  async function handleEquipAvatar(inventory: CrmAvatarInventory) {
    if (!member) return;
    setAvatarStatus({ loading: true, error: null, success: null });

    try {
      await equipAvatarMutation.mutateAsync({ memberId: member.id, inventoryId: inventory.id });
      setAvatarStatus({
        loading: false,
        error: null,
        success: `Avatar ${inventory.avatar?.name || "pilihan"} sekarang aktif`,
      });
    } catch (err) {
      setAvatarStatus({
        loading: false,
        error: err instanceof Error ? err.message : "Gagal memakai avatar",
        success: null,
      });
    }
  }

  async function handleGrantAvatar() {
    if (!member || !selectedGrantAvatar) return;
    setGrantStatus({ loading: true, error: null, success: null });

    try {
      await grantAvatarMutation.mutateAsync({
        member_id: member.id,
        avatar_id: selectedGrantAvatar.id,
        acquisition_source: grantSource,
        equip: grantEquip,
      });
      setGrantStatus({
        loading: false,
        error: null,
        success: `Avatar ${selectedGrantAvatar.name} berhasil diberikan`,
      });
    } catch (err) {
      setGrantStatus({
        loading: false,
        error: err instanceof Error ? err.message : "Gagal grant avatar",
        success: null,
      });
    }
  }

  async function handleEnroll() {
    if (!member?.customer_id) return;
    setEnrollStatus({ loading: true, error: null });

    try {
      const enrolledMember = await enrollMutation.mutateAsync({
        customerId: member.customer_id,
        metadata: { enrolled_by: "crm_member_detail" },
      });

      if (enrolledMember?.id) {
        router.replace(`/dashboard/crm/members/${enrolledMember.id}`);
        return;
      }

      setEnrollStatus({ loading: false, error: null });
    } catch (err) {
      setEnrollStatus({
        loading: false,
        error: err instanceof Error ? err.message : "Gagal aktivasi member CRM",
      });
    }
  }

  async function handleSaveProfile() {
    if (!member) return;
    setSaveStatus({ loading: true, error: null, success: null });

    try {
      await updateMemberMutation.mutateAsync({
        id: member.id,
        payload: {
          customer: {
            name: editForm.name,
            phone: editForm.phone || null,
            email: editForm.email || null,
            is_active: editForm.customerActive,
            is_kol: editForm.isKol,
            kol_monthly_limit_idr:
              editForm.isKol && editForm.kolLimit.trim() !== ""
                ? Number(editForm.kolLimit)
                : null,
          },
          member: crmProfileReady
            ? {
                tier_id: editForm.tierId || undefined,
                status: editForm.status,
              }
            : undefined,
        },
      });

      setSaveStatus({ loading: false, error: null, success: "Data member berhasil disimpan" });
    } catch (err) {
      setSaveStatus({
        loading: false,
        error: err instanceof Error ? err.message : "Gagal menyimpan member",
        success: null,
      });
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6">
        <div className="flex flex-col gap-3 border-b border-slate-200 pb-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <Link href="/dashboard/crm/members" className="inline-flex items-center gap-2 text-sm font-medium text-slate-500 transition hover:text-slate-900">
              <ArrowLeft className="size-4" />
              Members
            </Link>
            <h1 className="mt-2 text-2xl font-semibold tracking-normal text-slate-950">
              {member?.customer?.name || "Member Detail"}
            </h1>
          </div>
          <button
            type="button"
            onClick={() => void refetch()}
            disabled={loading}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-100 disabled:opacity-60"
          >
            <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>

        {member && !crmProfileReady && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 shadow-sm">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="text-sm font-semibold text-amber-950">Customer ini belum menjadi member CRM aktif.</div>
                <div className="mt-1 text-sm text-amber-800">
                  Aktivasi akan membuat profile CRM, menyinkronkan XP dari POS, dan membuka fitur redemption.
                </div>
                {enrollStatus.error && <div className="mt-2 text-sm font-medium text-red-700">{enrollStatus.error}</div>}
              </div>
              <button
                type="button"
                onClick={() => void handleEnroll()}
                disabled={enrollMutation.isPending}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-slate-950 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                <UserPlus className="size-4" />
                {enrollMutation.isPending ? "Mengaktifkan..." : "Aktifkan Member CRM"}
              </button>
            </div>
          </div>
        )}

        {errorMessage && (
          <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {errorMessage}
          </div>
        )}

        {loading && !member ? (
          <div className="rounded-lg border border-slate-200 bg-white px-4 py-12 text-center text-sm text-slate-500 shadow-sm">
            Memuat detail member...
          </div>
        ) : member ? (
          <>
            <section className="grid gap-4 lg:grid-cols-[1fr_360px]">
              <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                  <div className="flex items-start gap-3">
                    <div className="flex size-12 items-center justify-center rounded-md bg-slate-100 text-slate-700">
                      <UserRound className="size-6" />
                    </div>
                    <div>
                      <h2 className="text-lg font-semibold text-slate-950">{member.customer?.name || "Customer"}</h2>
                      <div className="mt-1 text-sm text-slate-500">
                        {member.customer?.phone || "-"} · {member.customer?.email || "-"}
                      </div>
                    </div>
                  </div>
                  <span className="w-fit rounded-md bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                    {member.status || "active"}
                  </span>
                </div>

                <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <DetailMetric label="Member Code" value={member.member_code} />
                  <DetailMetric label="Tier" value={tierName(member)} />
                  <DetailMetric label="Lifetime XP" value={formatNumber(member.lifetime_xp)} />
                  <DetailMetric label="ARK Coins" value={formatNumber(member.customer?.ark_coin_balance ?? 0)} />
                  <DetailMetric label="Total Spend" value={formatCurrency(member.customer?.total_spent ?? 0)} />
                  <DetailMetric label="Visit Count" value={formatNumber(member.customer?.visit_count ?? 0)} />
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <h3 className="text-base font-semibold text-slate-950">Membership Status</h3>
                <div className="mt-4 space-y-3 text-sm text-slate-600">
                  <StatusLine icon={CalendarClock} label="Joined" value={formatDate(member.joined_at)} />
                  <StatusLine icon={Sparkles} label="Last Activity" value={formatDateTime(member.last_activity_at)} />
                  <StatusLine icon={ShieldCheck} label="Tier Multiplier" value={member.tier?.xp_multiplier ? `${member.tier.xp_multiplier}x` : "1x"} />
                  <StatusLine icon={Coins} label="XP to Tier Rule" value={summary?.nextXp ? `${formatNumber(summary.nextXp)} XP` : "Current tier"} />
                </div>
              </div>
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex flex-col gap-2 border-b border-slate-200 pb-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <h3 className="text-base font-semibold text-slate-950">Customer & Member Settings</h3>
                  <p className="mt-1 text-sm text-slate-500">Update data customer, status member, dan tier manual.</p>
                </div>
                <button
                  type="button"
                  onClick={() => void handleSaveProfile()}
                  disabled={updateMemberMutation.isPending || !editForm.name.trim()}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-slate-950 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  <Save className="size-4" />
                  {updateMemberMutation.isPending ? "Menyimpan..." : "Simpan"}
                </button>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                <label className="block text-sm">
                  <span className="text-xs font-medium text-slate-500">Nama</span>
                  <input
                    value={editForm.name}
                    onChange={(event) => setEditForm((current) => ({ ...current, name: event.target.value }))}
                    className="mt-1 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-100"
                  />
                </label>
                <label className="block text-sm">
                  <span className="text-xs font-medium text-slate-500">Phone</span>
                  <input
                    value={editForm.phone}
                    onChange={(event) => setEditForm((current) => ({ ...current, phone: event.target.value }))}
                    className="mt-1 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-100"
                  />
                </label>
                <label className="block text-sm">
                  <span className="text-xs font-medium text-slate-500">Email</span>
                  <input
                    value={editForm.email}
                    onChange={(event) => setEditForm((current) => ({ ...current, email: event.target.value }))}
                    className="mt-1 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-100"
                  />
                </label>
                <label className="block text-sm">
                  <span className="text-xs font-medium text-slate-500">Tier Manual</span>
                  <select
                    value={editForm.tierId}
                    onChange={(event) => setEditForm((current) => ({ ...current, tierId: event.target.value }))}
                    disabled={!crmProfileReady}
                    className="mt-1 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-100 disabled:bg-slate-100 disabled:text-slate-400"
                  >
                    <option value="">Pilih tier</option>
                    {activeTiers.map((tier) => (
                      <option key={tier.id} value={tier.id}>
                        {tier.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm">
                  <span className="text-xs font-medium text-slate-500">Status Member</span>
                  <select
                    value={editForm.status}
                    onChange={(event) => setEditForm((current) => ({ ...current, status: event.target.value }))}
                    disabled={!crmProfileReady}
                    className="mt-1 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-100 disabled:bg-slate-100 disabled:text-slate-400"
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                    <option value="suspended">Suspended</option>
                    <option value="merged">Merged</option>
                  </select>
                </label>
                <label className="flex h-10 items-center gap-3 self-end rounded-md border border-slate-300 px-3 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={editForm.customerActive}
                    onChange={(event) => setEditForm((current) => ({ ...current, customerActive: event.target.checked }))}
                    className="size-4 rounded border-slate-300"
                  />
                  Customer aktif
                </label>
                <label className="flex h-10 items-center gap-3 self-end rounded-md border border-slate-300 px-3 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={editForm.isKol}
                    onChange={(event) => setEditForm((current) => ({ ...current, isKol: event.target.checked }))}
                    className="size-4 rounded border-slate-300"
                  />
                  KOL (komplimen gratis)
                </label>
                {editForm.isKol && (
                  <label className="text-sm text-slate-700">
                    Kuota komplimen / bulan (Rp)
                    <input
                      type="text"
                      inputMode="numeric"
                      value={editForm.kolLimit}
                      onChange={(event) =>
                        setEditForm((current) => ({
                          ...current,
                          kolLimit: event.target.value.replace(/\D/g, ""),
                        }))
                      }
                      placeholder="Kosong = tanpa batas"
                      className="mt-1 h-10 w-full rounded-md border border-slate-300 px-3"
                    />
                  </label>
                )}
              </div>

              {saveStatus.error && (
                <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {saveStatus.error}
                </div>
              )}
              {saveStatus.success && (
                <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                  {saveStatus.success}
                </div>
              )}
            </section>

            <section className="grid gap-4 lg:grid-cols-[0.85fr_1.15fr]">
              <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="flex items-center gap-2 text-base font-semibold text-slate-950">
                    <Crown className="size-4" />
                    Active Avatar
                  </h3>
                  <span className="rounded-md bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
                    {formatNumber(avatarInventory.length)} owned
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
                  <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                    Belum ada avatar aktif.
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
                      Redeem avatar dengan XP sudah dipensiunkan (EPIC-011): XP adalah
                      skor seumur hidup dan tidak pernah berkurang.
                    </div>
                    {avatarStatus.error && (
                      <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                        {avatarStatus.error}
                      </div>
                    )}
                    {avatarStatus.success && (
                      <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                        {avatarStatus.success}
                      </div>
                    )}

                    <div className="rounded-md border border-slate-200 bg-white p-3 shadow-sm">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-sm font-semibold text-slate-950">Admin Grant</div>
                        <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-500">
                          No XP
                        </span>
                      </div>
                      <div className="mt-3 space-y-3">
                        <label className="block text-sm">
                          <span className="text-xs font-medium text-slate-500">Avatar</span>
                          <select
                            value={selectedGrantAvatar?.id ?? ""}
                            onChange={(event) => setSelectedGrantAvatarId(event.target.value)}
                            disabled={grantableAvatars.length === 0 || grantAvatarMutation.isPending}
                            className="mt-1 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
                          >
                            {grantableAvatars.length === 0 ? (
                              <option value="">Tidak ada avatar tersedia</option>
                            ) : (
                              grantableAvatars.map((avatar) => (
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
                              onChange={(event) => setGrantSource(event.target.value as "manual" | "campaign" | "partner")}
                              disabled={grantAvatarMutation.isPending}
                              className="mt-1 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
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

                        {selectedGrantStockLeft === 0 && (
                          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                            Stok avatar sudah habis.
                          </div>
                        )}
                        {grantStatus.error && (
                          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                            {grantStatus.error}
                          </div>
                        )}
                        {grantStatus.success && (
                          <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                            {grantStatus.success}
                          </div>
                        )}

                        <button
                          type="button"
                          onClick={() => void handleGrantAvatar()}
                          disabled={!canGrantAvatar}
                          className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-800 shadow-sm transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                        >
                          <PlusCircle className="size-4" />
                          {grantAvatarMutation.isPending ? "Granting..." : "Grant Avatar"}
                        </button>
                      </div>
                    </div>
                  </div>

                  <div>
                    {avatarInventory.length === 0 ? (
                      <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                        Collection masih kosong.
                      </div>
                    ) : (
                      <div className="grid gap-3 sm:grid-cols-2">
                        {avatarInventory.map((inventory) => (
                          <div key={inventory.id} className="rounded-md border border-slate-200 bg-slate-50 p-3">
                            <div className="flex gap-3">
                              {inventory.avatar ? (
                                /* eslint-disable-next-line @next/next/no-img-element -- avatar URLs are admin-configured and can come from multiple providers */
                                <img
                                  src={inventory.avatar.thumbnail_url || inventory.avatar.image_url}
                                  alt={inventory.avatar.name}
                                  className="size-14 rounded-md border border-slate-200 bg-white object-cover"
                                />
                              ) : (
                                <div className="flex size-14 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-400">
                                  <ImageIcon className="size-5" />
                                </div>
                              )}
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-sm font-semibold text-slate-950">
                                  {inventory.avatar?.name || "Avatar"}
                                </div>
                                <div className="mt-1 text-xs text-slate-500">
                                  {inventory.avatar?.rarity || "collectible"} · {formatDate(inventory.acquired_at)}
                                </div>
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => void handleEquipAvatar(inventory)}
                              disabled={inventory.is_equipped || equipAvatarMutation.isPending}
                              className="mt-3 inline-flex h-9 w-full items-center justify-center rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-100 disabled:cursor-default disabled:border-emerald-200 disabled:bg-emerald-50 disabled:text-emerald-700"
                            >
                              {inventory.is_equipped ? "Active" : "Use Avatar"}
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </section>

            <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
                <h3 className="flex items-center gap-2 text-base font-semibold text-slate-950">
                  <History className="size-4" />
                  Avatar Activity
                </h3>
                <span className="text-xs text-slate-500">{formatNumber(avatarActivity.length)} records</span>
              </div>
              <div className="p-4">
                {avatarActivity.length === 0 ? (
                  <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                    Belum ada aktivitas avatar.
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100 overflow-hidden rounded-md border border-slate-200">
                    {avatarActivity.map((activity) => (
                      <div key={activity.id} className="grid grid-cols-[auto_1fr_auto] gap-3 px-4 py-3">
                        <div className={`mt-1 size-2.5 rounded-full ${activity.tone === "emerald" ? "bg-emerald-500" : activity.tone === "amber" ? "bg-amber-500" : activity.tone === "sky" ? "bg-sky-500" : "bg-slate-400"}`} />
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-slate-900">{activity.title}</div>
                          <div className="mt-1 truncate text-xs text-slate-500">{activity.detail}</div>
                        </div>
                        <div className="whitespace-nowrap text-xs text-slate-500">{formatDateTime(activity.date)}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>

            <section className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
              <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="flex items-center gap-2 text-base font-semibold text-slate-950">
                    <Gift className="size-4" />
                    Reward & Privilege
                  </h3>
                  <span className="rounded-md bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
                    {formatNumber(member.lifetime_xp)} XP
                  </span>
                </div>

                <div className="mt-4 space-y-3 text-sm text-slate-600">
                  <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                    XP adalah skor seumur hidup dan tidak pernah dipotong. XP
                    menentukan tier, membuka privilege produk khusus di kasir,
                    dan menjadi syarat kelayakan menukar reward.
                    <Link
                      href="/dashboard/crm/rewards"
                      className="mt-2 inline-flex items-center gap-1.5 font-medium text-slate-900 underline underline-offset-2"
                    >
                      <Gift className="size-3.5" />
                      Kelola &amp; klaim reward
                    </Link>
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
                <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
                  <h3 className="flex items-center gap-2 text-base font-semibold text-slate-950">
                    <TicketCheck className="size-4" />
                    Redemption History
                  </h3>
                  <span className="text-xs text-slate-500">{formatNumber(redemptions.length)} records</span>
                </div>
                <div className="p-4">
                  {redemptions.length === 0 ? (
                    <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                      Belum ada redemption.
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-100 overflow-hidden rounded-md border border-slate-200">
                      {redemptions.map((redemption) => (
                        <div key={redemption.id} className="grid grid-cols-[1fr_auto] gap-3 px-4 py-3">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium text-slate-900">
                              {redemption.reward?.name || redemption.redemption_number}
                            </div>
                            <div className="mt-1 text-xs text-slate-500">
                              {formatDateTime(redemption.requested_at)} · {redemption.status}
                              {redemption.voucher_code ? ` · ${redemption.voucher_code}` : ""}
                            </div>
                          </div>
                          <div className="text-right text-xs text-slate-500">
                            syarat {formatNumber(redemption.min_xp_at_redeem)} XP
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </section>

            <section className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
              <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
                <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
                  <h3 className="flex items-center gap-2 text-base font-semibold text-slate-950">
                    <History className="size-4" />
                    XP History
                  </h3>
                  <span className="text-xs text-slate-500">{formatNumber(xpLedger.length)} records</span>
                </div>
                <div className="p-4">
                  {xpLedger.length === 0 ? (
                    <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                      Belum ada XP history.
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-100 overflow-hidden rounded-md border border-slate-200">
                      {xpLedger.map((ledger) => (
                        <div key={ledger.id} className="grid grid-cols-[1fr_auto] gap-3 px-4 py-3">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium text-slate-900">
                              {ledger.description || `${ledger.source_channel} ${ledger.source_type}`}
                            </div>
                            <div className="mt-1 text-xs text-slate-500">
                              {formatDateTime(ledger.created_at)} · Balance {formatNumber(ledger.balance_after)}
                            </div>
                          </div>
                          <div className={`text-sm font-semibold ${ledger.xp_delta >= 0 ? "text-emerald-700" : "text-red-700"}`}>
                            {ledger.xp_delta >= 0 ? "+" : ""}
                            {formatNumber(ledger.xp_delta)}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
                <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
                  <h3 className="flex items-center gap-2 text-base font-semibold text-slate-950">
                    <ReceiptText className="size-4" />
                    Recent Orders
                  </h3>
                  <span className="text-xs text-slate-500">{formatNumber(recentOrders.length)} orders</span>
                </div>
                <div className="p-4">
                  {recentOrders.length === 0 ? (
                    <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                      Belum ada transaksi.
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-100 overflow-hidden rounded-md border border-slate-200">
                      {recentOrders.map((order) => (
                        <div key={order.id} className="grid grid-cols-[1fr_auto] gap-3 px-4 py-3">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium text-slate-900">{order.order_number}</div>
                            <div className="mt-1 text-xs text-slate-500">
                              {formatDateTime(order.ordered_at)} · {order.payment_status}
                            </div>
                          </div>
                          <div className="text-sm font-semibold text-slate-950">{formatCurrency(order.total_amount)}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </section>

            {member.customer_id && (
              <MemberEngagementPanel customerId={member.customer_id} memberKey={memberId} />
            )}
          </>
        ) : (
          <div className="rounded-lg border border-slate-200 bg-white px-4 py-12 text-center text-sm text-slate-500 shadow-sm">
            Member tidak ditemukan.
          </div>
        )}

        {member?.customer_id ? (
          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-3 text-sm font-semibold text-slate-950">Timeline CRM</div>
            <RecordTimeline
              subjectType="member"
              subjectId={member.customer_id}
              hideOnForbidden
              emptyText="Belum ada task atau percakapan tercatat untuk member ini."
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function DetailMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 truncate text-sm font-semibold text-slate-950">{value}</div>
    </div>
  );
}

function StatusLine({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof CalendarClock;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-md border border-slate-200 px-3 py-2">
      <Icon className="size-4 text-slate-400" />
      <div className="min-w-0">
        <div className="text-xs text-slate-500">{label}</div>
        <div className="truncate text-sm font-medium text-slate-800">{value}</div>
      </div>
    </div>
  );
}
