"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ArrowLeft, CalendarClock, Coins, RefreshCw, ShieldCheck, Sparkles, UserPlus, UserRound } from "lucide-react";
import { RecordTimeline } from "@/features/sales-funnel/timeline";
import { formatDate, formatDateTime, formatNumber, formatRupiah } from "@/lib/format";
import type { CrmMember, CrmTier, MemberDetailBundle } from "../types";
import { useMemberDetail } from "../queries";
import { useEnrollMember, useUpdateMember } from "../mutations";
import {
  activeTiersOf,
  editFormFromMember,
  isCrmProfileReady,
  tierName,
  toUpdateMemberPayload,
  xpToTierRule,
  type MemberEditForm,
} from "../member-detail";
import { MemberEngagementPanel } from "./member-engagement-panel";
import { MemberProfileForm } from "./member-profile-form";
import { MemberAvatarSection } from "./member-avatar-section";
import { MemberHistorySection } from "./member-history-section";
import { DetailMetric, NO_FEEDBACK, StatusLine, errorText, type Feedback } from "./member-detail-ui";

const NONE: never[] = [];

export function CrmMemberDetailPage() {
  const params = useParams<{ id: string }>();
  const memberId = params.id;
  const { data, isLoading, isFetching, error, refetch } = useMemberDetail(memberId);
  const loading = isLoading || isFetching;
  const member = data?.member ?? null;

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6">
        <div className="flex flex-col gap-3 border-b border-slate-200 pb-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <Link
              href="/dashboard/crm/members"
              className="inline-flex items-center gap-2 text-sm font-medium text-slate-500 transition hover:text-slate-900"
            >
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

        {member && !isCrmProfileReady(member) && <EnrollBanner member={member} />}

        {error instanceof Error && (
          <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error.message}</div>
        )}

        {loading && !member ? (
          <div className="rounded-lg border border-slate-200 bg-white px-4 py-12 text-center text-sm text-slate-500 shadow-sm">
            Memuat detail member...
          </div>
        ) : data?.member ? (
          <MemberDetailBody bundle={data} memberKey={memberId} />
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

function MemberDetailBody({ bundle, memberKey }: { bundle: MemberDetailBundle; memberKey: string }) {
  const { member } = bundle;
  const tiers: CrmTier[] = bundle.tiers ?? NONE;
  const activeTiers = useMemo(() => activeTiersOf(tiers), [tiers]);
  const crmProfileReady = isCrmProfileReady(member);
  const initialForm = editFormFromMember(member, activeTiers);
  const nextXp = xpToTierRule(member);

  const updateMutation = useUpdateMember();
  const [saveFeedback, setSaveFeedback] = useState<Feedback>(NO_FEEDBACK);

  async function saveProfile(form: MemberEditForm) {
    setSaveFeedback(NO_FEEDBACK);
    try {
      await updateMutation.mutateAsync({ id: member.id, payload: toUpdateMemberPayload(form, crmProfileReady) });
      setSaveFeedback({ error: null, success: "Data member berhasil disimpan" });
    } catch (err) {
      setSaveFeedback({ error: errorText(err, "Gagal menyimpan member"), success: null });
    }
  }

  return (
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
            <DetailMetric label="ARK Coins" value={formatNumber(member.customer?.ark_coin_balance)} />
            <DetailMetric label="Total Spend" value={formatRupiah(member.customer?.total_spent)} />
            <DetailMetric label="Visit Count" value={formatNumber(member.customer?.visit_count)} />
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="text-base font-semibold text-slate-950">Membership Status</h3>
          <div className="mt-4 space-y-3 text-sm text-slate-600">
            <StatusLine icon={CalendarClock} label="Joined" value={formatDate(member.joined_at)} />
            <StatusLine icon={Sparkles} label="Last Activity" value={formatDateTime(member.last_activity_at)} />
            <StatusLine
              icon={ShieldCheck}
              label="Tier Multiplier"
              value={member.tier?.xp_multiplier ? `${member.tier.xp_multiplier}x` : "1x"}
            />
            <StatusLine
              icon={Coins}
              label="XP to Tier Rule"
              value={nextXp ? `${formatNumber(nextXp)} XP` : "Current tier"}
            />
          </div>
        </div>
      </section>

      <MemberProfileForm
        // Mount ulang saat data server berubah supaya form mengikuti nilai terbaru.
        key={JSON.stringify(initialForm)}
        initial={initialForm}
        activeTiers={activeTiers}
        crmProfileReady={crmProfileReady}
        saving={updateMutation.isPending}
        feedback={saveFeedback}
        onSave={(form) => void saveProfile(form)}
      />

      <MemberAvatarSection
        member={member}
        avatars={bundle.avatars ?? NONE}
        inventory={bundle.avatarInventory ?? NONE}
        crmProfileReady={crmProfileReady}
      />

      <MemberHistorySection
        lifetimeXp={member.lifetime_xp}
        redemptions={bundle.redemptions ?? NONE}
        xpLedger={bundle.xpLedger ?? NONE}
        recentOrders={bundle.recentOrders ?? NONE}
      />

      {member.customer_id && <MemberEngagementPanel customerId={member.customer_id} memberKey={memberKey} />}
    </>
  );
}

function EnrollBanner({ member }: { member: CrmMember }) {
  const router = useRouter();
  const enrollMutation = useEnrollMember();
  const [enrollError, setEnrollError] = useState<string | null>(null);

  async function enroll() {
    if (!member.customer_id) return;
    setEnrollError(null);
    try {
      const enrolled = await enrollMutation.mutateAsync({
        customerId: member.customer_id,
        metadata: { enrolled_by: "crm_member_detail" },
      });
      if (enrolled?.id) router.replace(`/dashboard/crm/members/${enrolled.id}`);
    } catch (err) {
      setEnrollError(errorText(err, "Gagal aktivasi member CRM"));
    }
  }

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 shadow-sm">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="text-sm font-semibold text-amber-950">Customer ini belum menjadi member CRM aktif.</div>
          <div className="mt-1 text-sm text-amber-800">
            Aktivasi akan membuat profile CRM, menyinkronkan XP dari POS, dan membuka fitur redemption.
          </div>
          {enrollError && <div className="mt-2 text-sm font-medium text-red-700">{enrollError}</div>}
        </div>
        <button
          type="button"
          onClick={() => void enroll()}
          disabled={enrollMutation.isPending}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-slate-950 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          <UserPlus className="size-4" />
          {enrollMutation.isPending ? "Mengaktifkan..." : "Aktifkan Member CRM"}
        </button>
      </div>
    </div>
  );
}
