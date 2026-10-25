"use client";

import { useQuery } from "@tanstack/react-query";
import {
  Baby,
  Bandage,
  ClipboardList,
  Flag,
  HeartPulse,
  Lock,
  MessageCircleWarning,
  ShieldAlert,
  Sprout,
  Star,
  TriangleAlert,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatDate } from "@/lib/format";
import { CARE_KEYS, careApi, memberIds, type FlagIcon, type MemberFlag, type MemberFlags } from "../api";
import { FLAG_BADGE, hiddenMedicalLabel, indexByMember, REVIEW_LABEL } from "../display";

export const FLAG_ICONS: Record<FlagIcon, LucideIcon> = {
  flag: Flag,
  bandage: Bandage,
  heart: HeartPulse,
  baby: Baby,
  clipboard: ClipboardList,
  sprout: Sprout,
  star: Star,
  message: MessageCircleWarning,
  alert: TriangleAlert,
  shield: ShieldAlert,
};

/**
 * Penanda aktif untuk sekumpulan member (roster, check-in). Server sudah
 * menyaring detail medis sesuai hak user; yang tersisa hanya jumlahnya.
 */
export function useMemberFlags(ids: readonly string[]) {
  const key = memberIds(ids);
  const query = useQuery({
    queryKey: CARE_KEYS.members(key),
    queryFn: () => careApi.forMembers(key),
    enabled: key.length > 0,
    staleTime: 30_000,
  });
  return indexByMember(query.data);
}

export function FlagBadge({ flag }: { flag: MemberFlag }) {
  const Icon = FLAG_ICONS[flag.icon] ?? Flag;
  const details = [
    flag.note,
    flag.review_status ? REVIEW_LABEL[flag.review_status] + (flag.review_note ? `: ${flag.review_note}` : "") : "",
    flag.expires_on ? `Sampai ${formatDate(flag.expires_on)}` : "",
  ].filter(Boolean);
  const badge = (
    <Badge variant={FLAG_BADGE[flag.color] ?? "info"}>
      <Icon aria-hidden />
      {flag.type_label}
      {flag.review_status === "pending" && " · tinjau"}
    </Badge>
  );
  if (details.length === 0) return badge;
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex" tabIndex={0} />}>{badge}</TooltipTrigger>
      <TooltipContent className="max-w-72 whitespace-pre-line">{details.join("\n")}</TooltipContent>
    </Tooltip>
  );
}

/** Badge penanda satu member; penanda medis yang tidak boleh dibaca hanya muncul sebagai jumlah. */
export function FlagBadges({ entry, className }: { entry: MemberFlags | undefined; className?: string }) {
  if (!entry || (entry.flags.length === 0 && entry.hidden_medical === 0)) return null;
  return (
    <span className={className ?? "mt-1 flex flex-wrap gap-1"}>
      {entry.flags.map((f) => (
        <FlagBadge key={f.id} flag={f} />
      ))}
      {entry.hidden_medical > 0 && (
        <Badge variant="muted" title="Detailnya hanya untuk coach member ini dan manajer gym">
          <Lock aria-hidden />
          {hiddenMedicalLabel(entry.hidden_medical)}
        </Badge>
      )}
    </span>
  );
}
